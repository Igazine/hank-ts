import { Interpreter, Lexer, Parser, ValueType, HALScope } from '@igazine/hal';
import * as fs from 'node:fs';
import * as path from 'node:path';
class Runner {
    pathCache = new Map();
    macroMap = new Map();
    coreScope = new HALScope();
    constructor() { }
    registerTask(name, func) {
        this.coreScope.set(name, {
            type: ValueType.Task,
            task: { isNative: true, name, func }
        });
    }
    registerModule(name, tasks) {
        const moduleObj = new Map();
        for (const [tName, func] of Object.entries(tasks)) {
            moduleObj.set(tName, {
                type: ValueType.Task,
                task: { isNative: true, name: `${name}.${tName}`, func }
            });
        }
        this.coreScope.set(name, { type: ValueType.Object, value: moduleObj });
    }
    registerStd() {
        this.registerModule('log', {
            print: (args) => {
                console.log(args.map(a => this.valToString(a)).join(' '));
                return { type: ValueType.Void };
            },
            error: (args) => {
                console.error(args.map(a => this.valToString(a)).join(' '));
                return { type: ValueType.Void };
            },
            warn: (args) => {
                console.warn(`WARNING: ${args.map(a => this.valToString(a)).join(' ')}`);
                return { type: ValueType.Void };
            }
        });
        this.registerModule('runtime', {
            halt: (args) => {
                let code = 0;
                if (args.length > 0 && args[0].type === ValueType.Number)
                    code = args[0].value;
                console.log(`Exiting with code ${code}`);
                return { type: ValueType.Void };
            },
            elapsedTime: () => ({ type: ValueType.Number, value: 0 })
        });
        this.registerModule('env', {
            get: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Void };
                return { type: ValueType.Void };
            },
            set: () => ({ type: ValueType.Void }),
            keys: () => ({ type: ValueType.Array, value: [] })
        });
        this.registerModule('str', {
            length: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Void };
                return { type: ValueType.Number, value: this.valToString(args[0]).length };
            },
            format: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Void };
                let res = this.valToString(args[0]);
                for (let i = 1; i < args.length; i++) {
                    res = res.replace(`%${i}`, this.valToString(args[i]));
                }
                return { type: ValueType.String, value: res };
            },
            concat: (args) => ({ type: ValueType.String, value: args.map(a => this.valToString(a)).join('') }),
            trim: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Void };
                return { type: ValueType.String, value: this.valToString(args[0]).trim() };
            }
        });
        this.registerModule('regex', {
            parse: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Void };
                const pattern = this.valToString(args[0]);
                const flags = args.length > 1 ? this.valToString(args[1]) : "";
                let jsFlags = "";
                if (flags.includes('i'))
                    jsFlags += "i";
                if (flags.includes('m'))
                    jsFlags += "m";
                return {
                    type: ValueType.Regex,
                    pattern,
                    flags,
                    engine: new RegExp(pattern, jsFlags)
                };
            },
            match: (args) => {
                if (args.length < 2)
                    return { type: ValueType.Void };
                const s = this.valToString(args[0]);
                const pattern = args[1];
                if (pattern.type === ValueType.Regex) {
                    return pattern.engine?.test(s) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                }
                return s.includes(this.valToString(pattern)) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
            }
        });
        this.registerModule('math', {
            add: (args) => {
                let sum = 0;
                for (const a of args) {
                    if (a.type === ValueType.Number)
                        sum += a.value;
                }
                return { type: ValueType.Number, value: sum };
            },
            sub: (args) => {
                if (args.length < 2 || args[0].type !== ValueType.Number || args[1].type !== ValueType.Number)
                    return { type: ValueType.Void };
                return { type: ValueType.Number, value: args[0].value - args[1].value };
            },
            mul: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Number, value: 0 };
                let res = 1;
                for (const a of args) {
                    if (a.type === ValueType.Number)
                        res *= a.value;
                }
                return { type: ValueType.Number, value: res };
            },
            div: (args) => {
                if (args.length < 2 || args[0].type !== ValueType.Number || args[1].type !== ValueType.Number || args[1].value === 0)
                    return { type: ValueType.Void };
                return { type: ValueType.Number, value: args[0].value / args[1].value };
            },
            gt: (args) => {
                if (args.length < 2)
                    return { type: ValueType.Void };
                const a = args[0], b = args[1];
                if (a.type === ValueType.Number && b.type === ValueType.Number) {
                    return a.value > b.value ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                }
                return { type: ValueType.Void };
            },
            lt: (args) => {
                if (args.length < 2)
                    return { type: ValueType.Void };
                const a = args[0], b = args[1];
                if (a.type === ValueType.Number && b.type === ValueType.Number) {
                    return a.value < b.value ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                }
                return { type: ValueType.Void };
            },
            eq: (args) => {
                if (args.length < 2)
                    return { type: ValueType.Void };
                return this.valToString(args[0]) === this.valToString(args[1]) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
            }
        });
        this.registerModule('logic', {
            and: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Void };
                let last = { type: ValueType.Void };
                for (const a of args) {
                    if (a.type === ValueType.Void)
                        return { type: ValueType.Void };
                    last = a;
                }
                return last;
            },
            or: (args) => {
                for (const a of args) {
                    if (a.type !== ValueType.Void)
                        return a;
                }
                return { type: ValueType.Void };
            }
        });
        this.registerModule('arr', {
            length: (args) => {
                if (args.length > 0 && args[0].type === ValueType.Array)
                    return { type: ValueType.Number, value: args[0].value.length };
                return { type: ValueType.Void };
            },
            get: (args) => {
                if (args.length < 2 || args[0].type !== ValueType.Array || args[1].type !== ValueType.Number)
                    return { type: ValueType.Void };
                return args[0].value[args[1].value] || { type: ValueType.Void };
            },
            push: (args) => {
                if (args.length < 2 || args[0].type !== ValueType.Array)
                    return { type: ValueType.Void };
                args[0].value.push(args[1]);
                return { type: ValueType.Void };
            },
            pop: (args) => {
                if (args.length === 0 || args[0].type !== ValueType.Array)
                    return { type: ValueType.Void };
                return args[0].value.pop() || { type: ValueType.Void };
            },
            each: (args, ctx) => {
                if (args.length < 2 || args[0].type !== ValueType.Array || args[1].type !== ValueType.Task)
                    return { type: ValueType.Void };
                const items = [...args[0].value];
                items.forEach((item, idx) => {
                    ctx.call(args[1], [item, { type: ValueType.Number, value: idx }]);
                });
                return { type: ValueType.Void };
            }
        });
        this.registerModule('obj', {
            get: (args) => {
                if (args.length < 2 || args[0].type !== ValueType.Object)
                    return { type: ValueType.Void };
                const key = this.valToString(args[1]);
                return args[0].value.get(key) || { type: ValueType.Void };
            },
            keys: (args) => {
                if (args.length === 0 || args[0].type !== ValueType.Object)
                    return { type: ValueType.Void };
                const keys = Array.from(args[0].value.keys()).map(k => ({ type: ValueType.String, value: k }));
                return { type: ValueType.Array, value: keys };
            },
            values: (args) => {
                if (args.length === 0 || args[0].type !== ValueType.Object)
                    return { type: ValueType.Void };
                const vals = Array.from(args[0].value.values());
                return { type: ValueType.Array, value: vals };
            }
        });
        this.registerModule('json', {
            parse: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Void };
                try {
                    const data = JSON.parse(this.valToString(args[0]));
                    return this.mapAnyToHal(data);
                }
                catch (e) {
                    return { type: ValueType.Void };
                }
            },
            stringify: (args) => {
                if (args.length === 0)
                    return { type: ValueType.Void };
                const any = this.mapHalToAny(args[0]);
                return { type: ValueType.String, value: JSON.stringify(any) };
            }
        });
    }
    mapAnyToHal(v) {
        if (v === null || v === undefined)
            return { type: ValueType.Void };
        if (typeof v === 'number')
            return { type: ValueType.Number, value: v };
        if (typeof v === 'string')
            return { type: ValueType.String, value: v };
        if (typeof v === 'boolean')
            return v ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
        if (Array.isArray(v))
            return { type: ValueType.Array, value: v.map(i => this.mapAnyToHal(i)) };
        if (typeof v === 'object') {
            if (typeof v.serializeHAL === 'function')
                return { type: ValueType.String, value: v.serializeHAL() };
            if (v.constructor !== Object)
                throw new Error(`HAL Boundary Error: Complex host object [${v.constructor.name}] must implement serializeHAL() to bridge into HAL.`);
            const map = new Map();
            for (const [k, val] of Object.entries(v))
                map.set(k, this.mapAnyToHal(val));
            return { type: ValueType.Object, value: map };
        }
        throw new Error('HAL Boundary Error: Unrecognized type at execution boundary.');
    }
    mapHalToAny(v) {
        switch (v.type) {
            case ValueType.Number: return v.value;
            case ValueType.String: return v.value;
            case ValueType.Array: return v.value.map(i => this.mapHalToAny(i));
            case ValueType.Object:
                const obj = {};
                v.value.forEach((val, k) => { obj[k] = this.mapHalToAny(val); });
                return obj;
            default: return null;
        }
    }
    async run(scriptPath, args) {
        const absPath = path.resolve(scriptPath);
        this.preprocess(absPath, []);
        const content = this.pathCache.get(absPath);
        if (!content)
            throw new Error(`File not loaded: ${absPath}`);
        const lexer = new Lexer(content);
        const tokens = lexer.tokenize();
        const parser = new Parser(tokens, absPath, this.macroMap);
        const ast = parser.parse();
        const interp = new Interpreter(undefined, this.coreScope);
        const scriptTask = interp.run(ast);
        if (scriptTask.type !== ValueType.Task)
            throw new Error("Script did not evaluate to a Task");
        const res = interp.call(scriptTask, args, interp.globalScope);
        if (res.kind === 'Error')
            throw new Error(res.message);
        return res.value;
    }
    preprocess(filePath, stack) {
        const absPath = path.resolve(filePath);
        if (stack.includes(absPath))
            throw new Error(`Circular Dependency: ${absPath}`);
        if (this.pathCache.has(absPath))
            return;
        const content = fs.readFileSync(absPath, 'utf-8');
        this.pathCache.set(absPath, content);
        const newStack = [...stack, absPath];
        const macros = this.scanMacros(content);
        const parentDir = path.dirname(absPath);
        for (const m of macros) {
            const mPath = this.resolvePath(m, parentDir);
            const mAbsPath = path.resolve(mPath);
            this.preprocess(mAbsPath, newStack);
            this.macroMap.set(m, this.pathCache.get(mAbsPath));
        }
    }
    scanMacros(content) {
        const lexer = new Lexer(content);
        const tokens = lexer.tokenize();
        const macros = [];
        for (let i = 0; i < tokens.length - 1; i++) {
            if (tokens[i].type === 8) { // TokenType.At
                const next = tokens[i + 1];
                if (next.type === 0 || next.type === 2)
                    macros.push(next.literal);
            }
        }
        return macros;
    }
    resolvePath(m, baseDir) {
        if (path.isAbsolute(m))
            return m;
        let joined = path.join(baseDir, m);
        if (!path.extname(joined)) {
            if (fs.existsSync(joined + '.hal'))
                return joined + '.hal';
        }
        return joined;
    }
    valToString(v) {
        switch (v.type) {
            case ValueType.String: return v.value;
            case ValueType.Number: return v.value.toString();
            case ValueType.Void: return 'null';
            case ValueType.Array: return '[Array]';
            case ValueType.Object: return '{Object}';
            case ValueType.Regex: return '[Regex]';
            case ValueType.Task: return '[Task]';
            default: return 'null';
        }
    }
}
async function main() {
    const args = process.argv.slice(2);
    const runner = new Runner();
    runner.registerStd();
    if (args.length === 0) {
        await runConformance(runner);
        return;
    }
    const halArgs = args.slice(1).map(a => ({ type: ValueType.String, value: a }));
    try {
        const val = await runner.run(args[0], halArgs);
        if (val.type === ValueType.Number) {
            process.exit(val.value);
        }
        process.exit(0);
    }
    catch (e) {
        console.error(e.message || e);
        process.exit(1);
    }
}
async function runConformance(runner) {
    const root = process.cwd();
    // Submodule is at vendor/hal relative to the runner root (hal-ts/examples/runner)
    const workspaceRoot = path.resolve(root, '../../vendor/hal');
    const tests = [
        'test/conformance/01_literals.hal',
        'test/conformance/02_gates.hal',
        'test/conformance/03_scoping.hal',
        'test/conformance/04_hoisting.hal',
        'test/conformance/05_params.hal',
        'test/conformance/06_macros.hal',
        'test/conformance/07_returns.hal',
        'test/conformance/08_host_args.hal',
        'test/conformance/09_deep_nesting.hal',
        'test/conformance/10_edge_cases.hal',
        'test/conformance/11_regex_parse.hal',
        'test/conformance/12_data_advanced.hal',
        'test/conformance/13_logic_module.hal',
    ];
    for (const t of tests) {
        console.log(`--- Running: ${t} ---`);
        const fullPath = path.join(workspaceRoot, t);
        const args = t.endsWith('08_host_args.hal') ? [{ type: ValueType.String, value: 'Tamas' }] : [];
        try {
            await runner.run(fullPath, args);
        }
        catch (e) {
            console.log(`Test Failed: ${e.message || e}`);
        }
        console.log('--------------------\n');
    }
}
main();
