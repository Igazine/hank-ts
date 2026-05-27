import { Expr, Param, Value, ValueType, TaskValue, ExecutionContext, Scope, NativeFunc } from './Types.js';
import { Lexer } from './Lexer.js';
import { Parser } from './Parser.js';

export class Interpreter {
    globalScope: Scope;
    coreScope: Scope;
    private depth: number = 0;
    private static readonly MAX_DEPTH = 500;

    constructor(parentScope?: Scope, coreScope?: Scope) {
        this.coreScope = coreScope || new HALScope();
        this.globalScope = parentScope || new HALScope(this.coreScope);
    }

    run(expr: Expr): Value {
        this.hoist(expr, this.globalScope);
        const res = this.eval(expr, this.globalScope);
        if (res.kind === 'Error') {
            console.error(`Runtime Error: ${res.message}`);
            return { type: ValueType.Void };
        }
        return res.value;
    }

    private hoist(expr: Expr, scope: Scope) {
        if (expr.kind === 'Block') {
            for (const stmt of expr.stmts) this.hoist(stmt, scope);
        } else if (expr.kind === 'Assign') {
            if (expr.value.kind === 'FuncDef') {
                const res = this.eval(expr.value, scope);
                if (res.kind === 'Value') {
                    scope.set(expr.name, res.value);
                }
            }
        }
    }

    eval(expr: Expr, scope: Scope): EvalResult {
        switch (expr.kind) {
            case 'Block': {
                let last: Value = { type: ValueType.Void };
                for (const stmt of expr.stmts) {
                    if (stmt.kind === 'Assign' && stmt.value.kind === 'FuncDef') continue;
                    const res = this.eval(stmt, scope);
                    if (res.kind !== 'Value') return res;
                    last = res.value;
                }
                return { kind: 'Value', value: last };
            }
            case 'Assign': {
                const res = this.eval(expr.value, scope);
                if (res.kind === 'Value') {
                    scope.set(expr.name, res.value);
                    return { kind: 'Value', value: { type: ValueType.Void } };
                }
                return res;
            }
            case 'Literal': return { kind: 'Value', value: expr.value };
            case 'Ident': {
                const val = expr.isCore ? this.coreScope.get(expr.name) : scope.get(expr.name);
                return { kind: 'Value', value: val };
            }
            case 'Field': {
                const res = this.eval(expr.object, scope);
                if (res.kind === 'Value') {
                    if (res.value.type === ValueType.Object) {
                        return { kind: 'Value', value: res.value.value.get(expr.fieldName) || { type: ValueType.Void } };
                    }
                    return { kind: 'Value', value: { type: ValueType.Void } };
                }
                return res;
            }
            case 'FuncDef': {
                return { 
                    kind: 'Value', 
                    value: { 
                        type: ValueType.Task, 
                        task: { isNative: false, params: expr.params, body: expr.body, closure: scope } // <--- Capture current scope
                    } 
                };
            }
            case 'FuncCall': {
                if (this.depth > Interpreter.MAX_DEPTH) return { kind: 'Error', message: 'Stack overflow' };
                
                const resTarget = this.eval(expr.target, scope);
                if (resTarget.kind !== 'Value') return resTarget;
                const target = resTarget.value;
                
                const args: Value[] = [];
                for (const argExpr of expr.args) {
                    const res = this.eval(argExpr, scope);
                    if (res.kind !== 'Value') return res;
                    args.push(res.value);
                }
                
                return this.call(target, args, scope);
            }
            case 'UnOp': {
                const res = this.eval(expr.target, scope);
                if (res.kind !== 'Value') return res;
                const val = res.value;
                switch (expr.op) {
                    case '!': return { kind: 'Value', value: this.isTruthy(val) ? { type: ValueType.Void } : { type: ValueType.Number, value: 1 } };
                    case '?': return { kind: 'Value', value: val };
                    case '^': return { kind: 'Return', value: val };
                    default: return { kind: 'Value', value: { type: ValueType.Void } };
                }
            }
            case 'Object': {
                const map = new Map<string, Value>();
                for (const [k, vExpr] of expr.fields) {
                    const res = this.eval(vExpr, scope);
                    if (res.kind !== 'Value') return res;
                    map.set(k, res.value);
                }
                return { kind: 'Value', value: { type: ValueType.Object, value: map } };
            }
            case 'Array': {
                const vec: Value[] = [];
                for (const itemExpr of expr.items) {
                    const res = this.eval(itemExpr, scope);
                    if (res.kind !== 'Value') return res;
                    vec.push(res.value);
                }
                return { kind: 'Value', value: { type: ValueType.Array, value: vec } };
            }
            case 'FlowControl': {
                const condRes = this.eval(expr.condition, scope);
                if (condRes.kind !== 'Value') return condRes;
                
                const branch = this.isTruthy(condRes.value) ? expr.success : expr.fallback;
                if (!branch) return { kind: 'Value', value: { type: ValueType.Void } };
                
                this.hoist(branch, scope);
                const res = this.eval(branch, scope);
                if (res.kind === 'Error' && expr.rescue) {
                    const rescueScope = new HALScope(scope);
                    if (expr.catchVar) {
                        rescueScope.set(expr.catchVar, { type: ValueType.String, value: res.message });
                    }
                    this.hoist(expr.rescue, rescueScope);
                    return this.eval(expr.rescue, rescueScope);
                }
                return res;
            }
        }
    }

    call(task: Value, args: Value[], scope: Scope): EvalResult {
        if (task.type !== ValueType.Task) return { kind: 'Error', message: `Target is not a function: ${ValueType[task.type]}` };
        
        const tv = task.task;
        if (tv.isNative) {
            const ctx: ExecutionContext = {
                parse: (s) => {
                    const lexer = new Lexer(s);
                    const parser = new Parser(lexer.tokenize(), 'dynamic');
                    return parser.parse();
                },
                eval: (n) => {
                    const res = this.eval(n, scope);
                    if (res.kind === 'Error') throw res.message;
                    return res.value;
                },
                call: (t, as) => {
                    const res = this.call(t, as, scope);
                    if (res.kind === 'Error') throw res.message;
                    return res.value;
                },
                scope
            };
            try {
                return { kind: 'Value', value: tv.func(args, ctx) };
            } catch (e: any) {
                return { kind: 'Error', message: e.toString() };
            }
        }

        // User Task
        if (args.length > tv.params.length) return { kind: 'Error', message: 'Too many arguments' };
        
        this.depth++;
        // Use captured closure!
        const taskScope = new HALScope(tv.closure);
        
        for (let i = 0; i < tv.params.length; i++) {
            const p = tv.params[i];
            let val: Value;
            if (i < args.length) val = args[i];
            else if (p.defaultValue) {
                const res = this.eval(p.defaultValue, taskScope);
                if (res.kind !== 'Value') { this.depth--; return res; }
                val = res.value;
            } else if (p.isOptional) val = { type: ValueType.Void };
            else { this.depth--; return { kind: 'Error', message: `Missing required argument: ${p.name}` }; }
            taskScope.set(p.name, val);
        }

        this.hoist(tv.body, taskScope);
        const res = this.eval(tv.body, taskScope);
        this.depth--;
        if (res.kind === 'Return') return { kind: 'Value', value: res.value };
        return res;
    }

    private isTruthy(v: Value): boolean {
        return v.type !== ValueType.Void;
    }
}

export type EvalResult = 
    | { kind: 'Value', value: Value }
    | { kind: 'Return', value: Value }
    | { kind: 'Error', message: string };

export class HALScope implements Scope {
    private values: Map<string, Value> = new Map();
    private parent?: Scope;

    constructor(parent?: Scope) {
        this.parent = parent;
    }

    get(name: string): Value {
        return this.values.get(name) || this.parent?.get(name) || { type: ValueType.Void };
    }

    set(name: string, val: Value): void {
        this.values.set(name, val);
    }

    exists(name: string): boolean {
        return this.values.has(name) || (this.parent?.exists(name) || false);
    }
}
