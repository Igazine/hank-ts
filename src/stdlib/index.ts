import { Value, ValueType, NativeFunc, Expr, Resource, HankError, IHankExtension, ExecutionContext } from '../Types.js';
import { HankErrorRegistry } from '../ErrorRegistry.js';

export class StdLib implements IHankExtension {
    public readonly name = "StdLib";

    public getModules(): Record<string, Record<string, NativeFunc>> {
        const valToString = (v: Value): string => {
            switch (v.type) {
                case ValueType.String: return v.value;
                case ValueType.Number: {
                    let s = v.value.toString();
                    if (s.endsWith('.0')) s = s.substring(0, s.length - 2);
                    return s;
                }
                case ValueType.Void: return 'Void';
                case ValueType.Array: return '[Array]';
                case ValueType.Map: return '[Map]';
                case ValueType.Opaque: return `[Opaque:${v.label}]`;
                case ValueType.Task: return '[Task]';
                case ValueType.Error: return `[Error:${v.code}]`;
                default: return 'Void';
            }
        };

        const hankEquals = (a: Value, b: Value): boolean => {
            if (a.type !== b.type) return false;
            switch (a.type) {
                case ValueType.Void: return true;
                case ValueType.Number: return a.value === b.value;
                case ValueType.String: return a.value === b.value;
                case ValueType.Array:
                    if (a.value.length !== b.value.length) return false;
                    for (let i = 0; i < a.value.length; i++) if (!hankEquals(a.value[i], b.value[i])) return false;
                    return true;
                case ValueType.Map:
                    if (a.value.size !== b.value.size) return false;
                    for (const [k, v] of a.value) if (!b.value.has(k) || !hankEquals(v, b.value.get(k))) return false;
                    return true;
                case ValueType.Opaque: return a.label === b.label && a.value === b.value;
                case ValueType.Error:
                    if (a.code !== b.code || a.args?.length !== b.args?.length) return false;
                    for (let i = 0; i < (a.args?.length || 0); i++) if (!hankEquals(a.args![i], b.args![i])) return false;
                    return true;
                default: return false;
            }
        };

        return {
            log: {
                print: (args) => { console.log(args.map(valToString).join(' ')); return { type: ValueType.Void }; },
                error: (args) => { console.error(args.map(valToString).join(' ')); return { type: ValueType.Void }; },
                warn: (args) => { console.warn(`[WARN] ${args.map(valToString).join(' ')}`); return { type: ValueType.Void }; }
            },
            runtime: {
                halt: (args) => { process.exit(args.length > 0 && args[0].type === ValueType.Number ? args[0].value : 0); },
                elapsedTime: () => ({ type: ValueType.Number, value: 0 }),
                signal: (args) => {
                    if (args.length > 0) console.log(`[SIGNAL] ${valToString(args[0])}`);
                    return { type: ValueType.Void };
                }
            },
            loop: {
                while: (args, ctx) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    const cond = args[0];
                    const body = args[1];
                    let last: Value = { type: ValueType.Void };
                    while (true) {
                        const condVal = ctx.call(cond, []);
                        if (ctx.isError(condVal)) return condVal;
                        if (condVal.type === ValueType.Void) break;
                        
                        const res = ctx.call(body, []);
                        if (res.type === ValueType.Opaque && res.label === '__ControlFlow' && String(res.value) === 'Break') break;
                        if (ctx.isError(res)) return res;
                        last = res;
                    }
                    return last;
                },
                break: () => ({ type: ValueType.Opaque, label: '__ControlFlow', value: 'Break' })
            },
            str: {
                length: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.String) {
                        return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "String" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "str.length" }] };
                    }
                    return { type: ValueType.Number, value: args[0].value.length };
                },
                format: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    let res = valToString(args[0]);
                    for (let i = 1; i < args.length; i++) {
                        res = res.replace(`%${i}`, valToString(args[i]));
                    }
                    return { type: ValueType.String, value: res };
                },
                concat: (args) => ({ type: ValueType.String, value: args.map(a => valToString(a)).join('') }),
                trim: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.String) {
                        return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "String" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "str.trim" }] };
                    }
                    return { type: ValueType.String, value: args[0].value.trim() };
                }
            },
            num: {
                parse: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    const s = valToString(args[0]);
                    let base = 0;
                    if (args.length > 1 && args[1].type === ValueType.Number) base = args[1].value;
                    if (base === 0) {
                        if (s.startsWith("0x")) base = 16;
                        else if (s.startsWith("0b")) base = 2;
                        else if (s.startsWith("0o")) base = 8;
                        else base = 10;
                    }
                    const n = parseInt(s, base);
                    if (isNaN(n)) return { type: ValueType.Void };
                    return { type: ValueType.Number, value: n };
                },
                format: (args) => {
                    if (args.length === 0 || args[0].type !== ValueType.Number) return { type: ValueType.Void };
                    const n = args[0].value;
                    let base = 10;
                    if (args.length > 1 && args[1].type === ValueType.Number) base = args[1].value;
                    if (base < 2 || base > 36) return { type: ValueType.Void };
                    return { type: ValueType.String, value: n.toString(base) };
                }
            },
            math: {
                add: (args) => {
                    let sum = 0;
                    for (const a of args) {
                        if (a.type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[a.type] }, { type: ValueType.String, value: "math.add" }] };
                        sum += a.value;
                    }
                    return { type: ValueType.Number, value: sum };
                },
                sub: (args) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "math.sub" }] };
                    if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[1].type] }, { type: ValueType.String, value: "math.sub" }] };
                    return { type: ValueType.Number, value: args[0].value - args[1].value };
                },
                mul: (args) => {
                    if (args.length === 0) return { type: ValueType.Number, value: 0 };
                    let res = 1;
                    for (const a of args) {
                        if (a.type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[a.type] }, { type: ValueType.String, value: "math.mul" }] };
                        res *= a.value;
                    }
                    return { type: ValueType.Number, value: res };
                },
                div: (args) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "math.div" }] };
                    if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[1].type] }, { type: ValueType.String, value: "math.div" }] };
                    if (args[1].value === 0) return { type: ValueType.Void };
                    return { type: ValueType.Number, value: args[0].value / args[1].value };
                },
                gt: (args) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "math.gt" }] };
                    if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[1].type] }, { type: ValueType.String, value: "math.gt" }] };
                    return args[0].value > args[1].value ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                },
                lt: (args) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "math.lt" }] };
                    if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[1].type] }, { type: ValueType.String, value: "math.lt" }] };
                    return args[0].value < args[1].value ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                },
                eq: (args) => (args.length < 2) ? { type: ValueType.Void } : (hankEquals(args[0], args[1]) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void })
            },
            logic: {
                and: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    let last: Value = { type: ValueType.Void };
                    for (const a of args) {
                        if (a.type === ValueType.Void) return { type: ValueType.Void };
                        last = a;
                    }
                    return last;
                },
                or: (args) => {
                    for (const a of args) if (a.type !== ValueType.Void) return a;
                    return { type: ValueType.Void };
                },
                eq: (args) => (args.length < 2) ? { type: ValueType.Void } : (hankEquals(args[0], args[1]) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void })
            },
            arr: {
                length: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Array) {
                        return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "arr.length" }] };
                    }
                    return { type: ValueType.Number, value: args[0].value.length };
                },
                get: (args) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "arr.get" }] };
                    if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: ValueType[args[1].type] }, { type: ValueType.String, value: "arr.get" }] };
                    return args[0].value[args[1].value] || { type: ValueType.Void };
                },
                push: (args) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "arr.push" }] };
                    args[0].value.push(args[1]);
                    return { type: ValueType.Void };
                },
                pop: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "arr.pop" }] };
                    return args[0].value.pop() || { type: ValueType.Void };
                },
                each: (args, ctx) => {
                    if (args.length < 2) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "arr.each" }] };
                    const items = [...args[0].value];
                    const task = args[1];
                    for (let i = 0; i < items.length; i++) {
                        const res = ctx.call(task, [items[i], { type: ValueType.Number, value: i }]);
                        if (res.type === ValueType.Opaque && res.label === '__ControlFlow' && String(res.value) === 'Break') break;
                        if (ctx.isError(res)) return res;
                    }
                    return { type: ValueType.Void };
                }
            },
            map: {
                get: (args) => {
                    if (args.length < 2 || args[0].type !== ValueType.Map) return { type: ValueType.Void };
                    return args[0].value.get(valToString(args[1])) || { type: ValueType.Void };
                },
                set: (args) => {
                    if (args.length < 3) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Map) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Map" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "map.set" }] };
                    args[0].value.set(valToString(args[1]), args[2]);
                    return { type: ValueType.Void };
                },
                keys: (args) => (args.length > 0 && args[0].type === ValueType.Map) ? { type: ValueType.Array, value: Array.from(args[0].value.keys()).map(k => ({ type: ValueType.String, value: k })) } : { type: ValueType.Void }
            },
            json: {
                parse: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    const s = valToString(args[0]);
                    try {
                        const parsed = JSON.parse(s);
                        const mapAnyToHank = (v: any): Value => {
                            if (v === null || v === undefined) return { type: ValueType.Void };
                            if (typeof v === 'number') return { type: ValueType.Number, value: v };
                            if (typeof v === 'string') return { type: ValueType.String, value: v };
                            if (typeof v === 'boolean') return { type: ValueType.Number, value: v ? 1 : 0 };
                            if (Array.isArray(v)) return { type: ValueType.Array, value: v.map(mapAnyToHank) };
                            if (typeof v === 'object') {
                                const m = new Map<string, Value>();
                                for (const [key, val] of Object.entries(v)) {
                                    m.set(key, mapAnyToHank(val));
                                }
                                return { type: ValueType.Map, value: m };
                            }
                            return { type: ValueType.Void };
                        };
                        return mapAnyToHank(parsed);
                    } catch (e) {
                        return { type: ValueType.Void };
                    }
                },
                stringify: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    const mapHankToAny = (v: Value): any => {
                        switch (v.type) {
                            case ValueType.Number: return v.value;
                            case ValueType.String: return v.value;
                            case ValueType.Array: return v.value.map(mapHankToAny);
                            case ValueType.Map:
                                const obj: any = {};
                                for (const [k, val] of v.value) {
                                    obj[k] = mapHankToAny(val);
                                }
                                return obj;
                            default: return null;
                        }
                    };
                    try {
                        return { type: ValueType.String, value: JSON.stringify(mapHankToAny(args[0])) };
                    } catch (e) {
                        return { type: ValueType.Void };
                    }
                }
            },
            err: {
                code: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Error) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Error" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "err.code" }] };
                    return { type: ValueType.Number, value: args[0].code };
                },
                message: (args, ctx) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Error) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Error" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "err.message" }] };
                    const err = args[0];
                    const loc = ctx.getLocalization();
                    let tmpl = loc[err.code!] || "Unknown Error";
                    (err.args || []).forEach((a, i) => {
                        tmpl = tmpl.replace(`{${i}}`, valToString(a));
                    });
                    return { type: ValueType.String, value: tmpl };
                },
                args: (args) => {
                    if (args.length === 0) return { type: ValueType.Void };
                    if (args[0].type !== ValueType.Error) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Error" }, { type: ValueType.String, value: ValueType[args[0].type] }, { type: ValueType.String, value: "err.args" }] };
                    return { type: ValueType.Array, value: args[0].args || [] };
                },
                isError: (args) => (args.length > 0 && args[0].type === ValueType.Error) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void }
            }
        };
    }
}
