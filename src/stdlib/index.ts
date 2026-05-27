import { Value, ValueType, NativeFunc, ExecutionContext, Scope } from '../Types.js';

export const StdLib = {
    /**
     * Returns the recommended standard library modules.
     * Developers should register these manually on their Runner.
     */
    getModules(): Record<string, Record<string, NativeFunc>> {
        const valToString = (v: Value): string => {
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
        };

        const mapAnyToHal = (v: any): Value => {
            if (v === null || v === undefined) return { type: ValueType.Void };
            if (typeof v === 'number') return { type: ValueType.Number, value: v };
            if (typeof v === 'string') return { type: ValueType.String, value: v };
            if (typeof v === 'boolean') return v ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
            if (Array.isArray(v)) return { type: ValueType.Array, value: v.map(i => mapAnyToHal(i)) };
            if (typeof v === 'object') {
                const map = new Map<string, Value>();
                for (const [k, val] of Object.entries(v)) map.set(k, mapAnyToHal(val));
                return { type: ValueType.Object, value: map };
            }
            return { type: ValueType.Void };
        };

        const mapHalToAny = (v: Value): any => {
            switch (v.type) {
                case ValueType.Number: return v.value;
                case ValueType.String: return v.value;
                case ValueType.Array: return (v as any).value.map((i: any) => mapHalToAny(i));
                case ValueType.Object:
                    const obj: any = {};
                    (v as any).value.forEach((val: any, k: any) => { obj[k] = mapHalToAny(val); });
                    return obj;
                default: return null;
            }
        };

        return {
            log: {
                print: (args) => { console.log(args.map(a => valToString(a)).join(' ')); return { type: ValueType.Void }; },
                error: (args) => { console.error(args.map(a => valToString(a)).join(' ')); return { type: ValueType.Void }; },
                warn: (args) => { console.warn(`WARNING: ${args.map(a => valToString(a)).join(' ')}`); return { type: ValueType.Void }; }
            },
            runtime: {
                halt: (args) => {
                    let code = 0;
                    if (args.length > 0 && args[0].type === ValueType.Number) code = (args[0] as any).value;
                    if (typeof process !== 'undefined') process.exit(code);
                    return { type: ValueType.Void };
                },
                elapsedTime: () => ({ type: ValueType.Number, value: 0 }),
                sleep: (args) => {
                    const ms = (args.length > 0 && args[0].type === ValueType.Number) ? (args[0] as any).value : 0;
                    return new Promise(resolve => setTimeout(() => resolve({ type: ValueType.Void }), ms)) as any;
                },
                loop: (args, ctx) => {
                    if (args.length > 0 && args[0].type === ValueType.Task) {
                        const task = args[0];
                        const runLoop = () => {
                            const res = ctx.call(task, []);
                            if (res.type === ValueType.Void) {
                                setTimeout(runLoop, 0);
                            }
                        };
                        runLoop();
                    }
                    return { type: ValueType.Void };
                }
            },
            env: {
                get: () => ({ type: ValueType.Void }),
                set: () => ({ type: ValueType.Void }),
                keys: () => ({ type: ValueType.Array, value: [] })
            },
            str: {
                length: (args) => args.length === 0 ? { type: ValueType.Void } : { type: ValueType.Number, value: valToString(args[0]).length },
                format: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    let res = valToString(args[0]);
                    for (let i = 1; i < args.length; i++) { res = res.replace(`%${i}`, valToString(args[i])); }
                    return { type: ValueType.String, value: res };
                },
                concat: (args) => ({ type: ValueType.String, value: args.map(a => valToString(a)).join('') }),
                trim: (args) => args.length === 0 ? { type: ValueType.Void } : { type: ValueType.String, value: valToString(args[0]).trim() }
            },
            math: {
                add: (args) => ({ type: ValueType.Number, value: args.reduce((sum, a) => sum + (a.type === ValueType.Number ? (a as any).value : 0), 0) }),
                sub: (args) => (args.length < 2 || args[0].type !== ValueType.Number || args[1].type !== ValueType.Number) ? { type: ValueType.Void } : { type: ValueType.Number, value: (args[0] as any).value - (args[1] as any).value },
                mul: (args) => (args.length === 0) ? { type: ValueType.Number, value: 0 } : { type: ValueType.Number, value: args.reduce((res, a) => res * (a.type === ValueType.Number ? (a as any).value : 1), 1) },
                div: (args) => (args.length < 2 || args[1].type !== ValueType.Number || (args[1] as any).value === 0) ? { type: ValueType.Void } : { type: ValueType.Number, value: (args[0] as any).value / (args[1] as any).value },
                gt: (args) => (args.length < 2 || args[0].type !== ValueType.Number || args[1].type !== ValueType.Number) ? { type: ValueType.Void } : ((args[0] as any).value > (args[1] as any).value ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void }),
                lt: (args) => (args.length < 2 || args[0].type !== ValueType.Number || args[1].type !== ValueType.Number) ? { type: ValueType.Void } : ((args[0] as any).value < (args[1] as any).value ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void }),
                eq: (args) => (args.length < 2) ? { type: ValueType.Void } : (valToString(args[0]) === valToString(args[1]) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void })
            },
            logic: {
                and: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    let last: Value = { type: ValueType.Void };
                    for (const a of args) { if (a.type === ValueType.Void) return { type: ValueType.Void }; last = a; }
                    return last;
                },
                or: (args) => {
                    for (const a of args) { if (a.type !== ValueType.Void) return a; }
                    return { type: ValueType.Void };
                }
            },
            arr: {
                length: (args) => (args.length > 0 && args[0].type === ValueType.Array) ? { type: ValueType.Number, value: (args[0] as any).value.length } : { type: ValueType.Void },
                get: (args) => (args.length < 2 || args[0].type !== ValueType.Array || args[1].type !== ValueType.Number) ? { type: ValueType.Void } : ((args[0] as any).value[(args[1] as any).value] || { type: ValueType.Void }),
                push: (args) => { if (args.length >= 2 && args[0].type === ValueType.Array) (args[0] as any).value.push(args[1]); return { type: ValueType.Void }; },
                pop: (args) => (args.length > 0 && args[0].type === ValueType.Array) ? ((args[0] as any).value.pop() || { type: ValueType.Void }) : { type: ValueType.Void },
                each: (args, ctx) => {
                    if (args.length >= 2 && args[0].type === ValueType.Array && args[1].type === ValueType.Task) {
                        const items = [...(args[0] as any).value];
                        items.forEach((item, idx) => {
                            const callArgs = [item, { type: ValueType.Number, value: idx }];
                            const task = args[1];
                            if (task.type === ValueType.Task && !task.task.isNative) {
                                if (callArgs.length > task.task.params.length) callArgs.splice(task.task.params.length);
                            }
                            ctx.call(args[1], callArgs);
                        });
                    }
                    return { type: ValueType.Void };
                }
            },
            obj: {
                get: (args) => (args.length >= 2 && args[0].type === ValueType.Object) ? ((args[0] as any).value.get(valToString(args[1])) || { type: ValueType.Void }) : { type: ValueType.Void },
                keys: (args) => (args.length > 0 && args[0].type === ValueType.Object) ? { type: ValueType.Array, value: Array.from((args[0] as any).value.keys()).map(k => ({ type: ValueType.String, value: k } as Value)) } : { type: ValueType.Void },
                values: (args) => (args.length > 0 && args[0].type === ValueType.Object) ? { type: ValueType.Array, value: Array.from((args[0] as any).value.values()) } : { type: ValueType.Void }
            },
            json: {
                parse: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    try { return mapAnyToHal(JSON.parse(valToString(args[0]))); } catch (e) { return { type: ValueType.Void }; }
                },
                stringify: (args) => (args.length > 0) ? { type: ValueType.String, value: JSON.stringify(mapHalToAny(args[0])) } : { type: ValueType.Void }
            },
            regex: {
                parse: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    const pattern = valToString(args[0]);
                    const flags = args.length > 1 ? valToString(args[1]) : "";
                    let jsFlags = "";
                    if (flags.includes('i')) jsFlags += "i";
                    if (flags.includes('m')) jsFlags += "m";
                    try { return { type: ValueType.Regex, pattern, flags, engine: new RegExp(pattern, jsFlags) }; } catch (e) { return { type: ValueType.Void }; }
                },
                match: (args) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    const s = valToString(args[0]);
                    const pattern = args[1];
                    if (pattern.type === ValueType.Regex) return pattern.engine?.test(s) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                    return s.includes(valToString(pattern)) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                },
                replace: (args) => {
                    if (args.length < 3) return { type: ValueType.Void };
                    const s = valToString(args[0]);
                    const pattern = args[1];
                    const repl = valToString(args[2]);
                    if (pattern.type === ValueType.Regex && pattern.engine) return { type: ValueType.String, value: s.replace(pattern.engine, repl) };
                    return { type: ValueType.String, value: s.split(valToString(pattern)).join(repl) };
                }
            }
        };
    }
};
