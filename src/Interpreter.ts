import { Expr, Param, Scope, TokenData, Value, ValueType, ExecutionContext } from './Types.js';

export class Interpreter implements ExecutionContext {
    public globalScope: Scope;
    private coreScope: Scope;

    constructor(parentScope: Scope | undefined, coreScope: Scope) {
        this.coreScope = coreScope;
        this.globalScope = new HALScope(parentScope || coreScope);
    }

    run(ast: Expr): Value {
        return this.eval(ast);
    }

    eval(node: Expr): Value {
        return this.evalInScope(node, this.globalScope);
    }

    private evalInScope(node: Expr, scope: Scope): Value {
        switch (node.kind) {
            case 'Literal': return node.value;
            case 'Ident':
                if (node.isCore) return this.coreScope.get(node.name);
                return scope.get(node.name);
            case 'Assign':
                const val = this.evalInScope(node.value, scope);
                scope.set(node.name, val);
                return val;
            case 'Block':
                // --- TASK HOISTING PASS ---
                for (const stmt of node.stmts) {
                    if (stmt.kind === 'Assign') {
                        if (stmt.value.kind === 'FuncDef') {
                            scope.set(stmt.name, this.evalInScope(stmt.value, scope));
                        } else if (stmt.value.kind === 'Assign') {
                            const inner = stmt.value;
                            if (inner.value.kind === 'FuncDef') {
                                scope.set(inner.name, this.evalInScope(inner.value, scope));
                            }
                        }
                    }
                }

                let last: Value = { type: ValueType.Void };
                for (const stmt of node.stmts) {
                    last = this.evalInScope(stmt, scope);
                    if (last.type === ValueType.Void && last.value === '_RETURN_') return last;
                }
                return last;
            case 'FuncDef':
                return {
                    type: ValueType.Task,
                    task: {
                        isNative: false,
                        name: 'anonymous',
                        params: node.params,
                        body: node.body,
                        closure: scope
                    }
                };
            case 'FuncCall':
                const target = this.evalInScope(node.target, scope);
                const args = node.args.map(a => this.evalInScope(a, scope));
                return this.internalCall(target, args);
            case 'Field':
                const obj = this.evalInScope(node.object, scope);
                if (obj.type === ValueType.Object) {
                    return obj.value.get(node.fieldName) || { type: ValueType.Void };
                }
                if (obj.type === ValueType.Array) {
                    if (node.fieldName === 'length') return { type: ValueType.Number, value: obj.value.length };
                }
                if (obj.type === ValueType.String) {
                    if (node.fieldName === 'length') return { type: ValueType.Number, value: obj.value.length };
                }
                return { type: ValueType.Void };
            case 'Object':
                const fields = new Map<string, Value>();
                node.fields.forEach((expr, key) => {
                    fields.set(key, this.evalInScope(expr, scope));
                });
                return { type: ValueType.Object, value: fields };
            case 'Array':
                return { type: ValueType.Array, value: node.items.map(i => this.evalInScope(i, scope)) };
            case 'UnOp':
                if (node.op === '!') {
                    const v = this.evalInScope(node.target, scope);
                    return v.type === ValueType.Void ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                }
                if (node.op === '^') {
                    const v = this.evalInScope(node.target, scope);
                    return { type: ValueType.Void, value: '_RETURN_', task: { isNative: true, name: 'return', native: () => v } };
                }
                return { type: ValueType.Void };
            case 'FlowControl':
                const cond = this.evalInScope(node.condition, scope);
                const isTruthy = cond.type !== ValueType.Void;
                if (isTruthy) {
                    try {
                        return this.evalInScope(node.success, scope);
                    } catch (e: any) {
                        if (node.rescue) {
                            const rescueScope = new HALScope(scope);
                            if (node.catchVar) {
                                rescueScope.set(node.catchVar, { type: ValueType.String, value: e.message || String(e) });
                            }
                            return this.evalInScope(node.rescue, rescueScope);
                        }
                        throw e;
                    }
                } else if (node.fallback) {
                    return this.evalInScope(node.fallback, scope);
                }
                return { type: ValueType.Void };
            default: return { type: ValueType.Void };
        }
    }

    public call(task: Value, args: Value[]): Value {
        let finalArgs = args;
        if (task.type === ValueType.Task && task.task && !task.task.isNative && task.task.params) {
            if (args.length > task.task.params.length) {
                finalArgs = args.slice(0, task.task.params.length);
            }
        }
        return this.internalCall(task, finalArgs);
    }

    private internalCall(task: Value, args: Value[]): Value {
        if (task.type !== ValueType.Task || !task.task) {
            throw new Error(`Target is not a function: ${this.valToString(task)}`);
        }

        if (task.task.isNative) {
            return task.task.native!(args, this);
        } else {
            const t = task.task;
            if (args.length > t.params!.length) throw new Error("Too many arguments");

            const callScope = new HALScope(t.closure);
            for (let i = 0; i < t.params!.length; i++) {
                const p = t.params![i];
                let val: Value = { type: ValueType.Void };
                if (i < args.length) {
                    val = args[i];
                } else if (p.defaultValue) {
                    val = this.evalInScope(p.defaultValue, callScope);
                } else if (!p.isOptional) {
                    throw new Error(`Missing required parameter: ${p.name}`);
                }
                callScope.set(p.name, val);
            }

            const res = this.evalInScope(t.body!, callScope);
            if (res.type === ValueType.Void && res.value === '_RETURN_') {
                return res.task!.native!([], this);
            }
            return res;
        }
    }

    get scope(): Scope {
        return this.globalScope;
    }

    private valToString(v: Value): string {
        switch (v.type) {
            case ValueType.String: return v.value;
            case ValueType.Number: return v.value.toString();
            case ValueType.Void: return 'null';
            case ValueType.Array: return '[Array]';
            case ValueType.Object: return '{Object}';
            case ValueType.Opaque: return `[Opaque:${v.label || 'Unknown'}]`;
            case ValueType.Task: return '[Task]';
            default: return 'null';
        }
    }
}

export class HALScope implements Scope {
    private values: Map<string, Value> = new Map();
    private parent: Scope | undefined;

    constructor(parent?: Scope) {
        this.parent = parent;
    }

    get(name: string): Value {
        if (this.values.has(name)) return this.values.get(name)!;
        if (this.parent) return this.parent.get(name);
        return { type: ValueType.Void };
    }

    set(name: string, val: Value): void {
        this.values.set(name, val);
    }

    exists(name: string): boolean {
        return this.values.has(name) || (this.parent?.exists(name) || false);
    }
}
