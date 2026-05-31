import { Value, ValueType, NativeFunc, Expr, Resource, HankError, IHankExtension, ExecutionContext } from '../Types.js';
import { HankErrorRegistry } from '../ErrorRegistry.js';

export class StdLib implements IHankExtension {
    public readonly name = "StdLib";
    public envState: Map<string, Value> = new Map();

    public getTasks(): Record<string, NativeFunc> {
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

        const typeToString = (t: ValueType): string => {
            return ValueType[t];
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
            // log
            log_print: (args) => { console.log(args.map(valToString).join(' ')); return { type: ValueType.Void }; },
            log_error: (args) => { console.error(args.map(valToString).join(' ')); return { type: ValueType.Void }; },
            log_warn: (args) => { console.warn(`[WARN] ${args.map(valToString).join(' ')}`); return { type: ValueType.Void }; },

            // runtime
            runtime_halt: (args) => { process.exit(args.length > 0 && args[0].type === ValueType.Number ? args[0].value : 0); },
            runtime_elapsedTime: () => ({ type: ValueType.Number, value: 0 }),
            runtime_signal: (args) => {
                if (args.length > 0) console.log(`[SIGNAL] ${valToString(args[0])}`);
                return { type: ValueType.Void };
            },

            // loop
            loop_while: (args, ctx) => {
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
            loop_break: () => ({ type: ValueType.Opaque, label: '__ControlFlow', value: 'Break' }),

            // env
            env_get: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                const key = valToString(args[0]);
                return this.envState.get(key) || { type: ValueType.Void };
            },
            env_set: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                const key = valToString(args[0]);
                this.envState.set(key, args[1]);
                return { type: ValueType.Void };
            },
            env_keys: () => ({
                type: ValueType.Array,
                value: Array.from(this.envState.keys()).map(k => ({ type: ValueType.String, value: k }))
            }),

            // str
            str_length: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.String) {
                    return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "String" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "str_length" }] };
                }
                return { type: ValueType.Number, value: args[0].value.length };
            },
            str_format: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                let res = valToString(args[0]);
                for (let i = 1; i < args.length; i++) {
                    res = res.replace(`%${i}`, valToString(args[i]));
                }
                return { type: ValueType.String, value: res };
            },
            str_concat: (args) => ({ type: ValueType.String, value: args.map(a => valToString(a)).join('') }),
            str_trim: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.String) {
                    return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "String" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "str_trim" }] };
                }
                return { type: ValueType.String, value: args[0].value.trim() };
            },

            // num
            num_parse: (args) => {
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
            num_format: (args) => {
                if (args.length === 0 || args[0].type !== ValueType.Number) return { type: ValueType.Void };
                const n = args[0].value;
                let base = 10;
                if (args.length > 1 && args[1].type === ValueType.Number) base = args[1].value;
                if (base < 2 || base > 36) return { type: ValueType.Void };
                return { type: ValueType.String, value: n.toString(base) };
            },

            // math
            math_add: (args) => {
                let sum = 0;
                for (const a of args) {
                    if (a.type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(a.type) }, { type: ValueType.String, value: "math_add" }] };
                    sum += a.value;
                }
                return { type: ValueType.Number, value: sum };
            },
            math_sub: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "math_sub" }] };
                if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[1].type) }, { type: ValueType.String, value: "math_sub" }] };
                return { type: ValueType.Number, value: args[0].value - args[1].value };
            },
            math_mul: (args) => {
                if (args.length === 0) return { type: ValueType.Number, value: 0 };
                let res = 1;
                for (const a of args) {
                    if (a.type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(a.type) }, { type: ValueType.String, value: "math_mul" }] };
                    res *= a.value;
                }
                return { type: ValueType.Number, value: res };
            },
            math_div: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "math_div" }] };
                if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[1].type) }, { type: ValueType.String, value: "math_div" }] };
                if (args[1].value === 0) return { type: ValueType.Void };
                return { type: ValueType.Number, value: args[0].value / args[1].value };
            },
            math_mod: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "math_mod" }] };
                if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[1].type) }, { type: ValueType.String, value: "math_mod" }] };
                if (args[1].value === 0) return { type: ValueType.Void };
                return { type: ValueType.Number, value: args[0].value % args[1].value };
            },
            math_gt: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "math_gt" }] };
                if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[1].type) }, { type: ValueType.String, value: "math_gt" }] };
                return args[0].value > args[1].value ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
            },
            math_lt: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "math_lt" }] };
                if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[1].type) }, { type: ValueType.String, value: "math_lt" }] };
                return args[0].value < args[1].value ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
            },
            math_eq: (args) => (args.length < 2) ? { type: ValueType.Void } : (hankEquals(args[0], args[1]) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void }),

            // logic
            logic_and: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                let last: Value = { type: ValueType.Void };
                for (const a of args) {
                    if (a.type === ValueType.Void) return { type: ValueType.Void };
                    last = a;
                }
                return last;
            },
            logic_or: (args) => {
                for (const a of args) if (a.type !== ValueType.Void) return a;
                return { type: ValueType.Void };
            },
            logic_eq: (args) => (args.length < 2) ? { type: ValueType.Void } : (hankEquals(args[0], args[1]) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void }),

            // type
            type_isVoid: (args) => (args.length > 0 && args[0].type === ValueType.Void) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },
            type_isNumber: (args) => (args.length > 0 && args[0].type === ValueType.Number) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },
            type_isString: (args) => (args.length > 0 && args[0].type === ValueType.String) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },
            type_isArray: (args) => (args.length > 0 && args[0].type === ValueType.Array) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },
            type_isMap: (args) => (args.length > 0 && args[0].type === ValueType.Map) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },
            type_isOpaque: (args) => (args.length > 0 && args[0].type === ValueType.Opaque) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },
            type_isTask: (args) => (args.length > 0 && args[0].type === ValueType.Task) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },
            type_isError: (args) => (args.length > 0 && args[0].type === ValueType.Error) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },

            // arr
            arr_length: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) {
                    return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_length" }] };
                }
                return { type: ValueType.Number, value: args[0].value.length };
            },
            arr_get: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_get" }] };
                if (args[1].type !== ValueType.Number) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Number" }, { type: ValueType.String, value: typeToString(args[1].type) }, { type: ValueType.String, value: "arr_get" }] };
                return args[0].value[args[1].value] || { type: ValueType.Void };
            },
            arr_push: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_push" }] };
                args[0].value.push(args[1]);
                return { type: ValueType.Void };
            },
            arr_pop: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_pop" }] };
                return args[0].value.pop() || { type: ValueType.Void };
            },
            arr_shift: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_shift" }] };
                return args[0].value.shift() || { type: ValueType.Void };
            },
            arr_unshift: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_unshift" }] };
                args[0].value.unshift(args[1]);
                return { type: ValueType.Void };
            },
            arr_slice: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_slice" }] };
                const start = args[1].type === ValueType.Number ? args[1].value : 0;
                const end = args.length > 2 && args[2].type === ValueType.Number ? args[2].value : undefined;
                return { type: ValueType.Array, value: args[0].value.slice(start, end) };
            },
            arr_sort: (args, ctx) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_sort" }] };
                const arr = args[0].value;
                const task = args.length > 1 ? args[1] : undefined;
                if (task) {
                    arr.sort((a: any, b: any) => {
                        const res = ctx.call(task, [a, b]);
                        return res.type === ValueType.Number ? res.value : 0;
                    });
                } else {
                    arr.sort((a: any, b: any) => {
                        const sa = valToString(a);
                        const sb = valToString(b);
                        return sa === sb ? 0 : (sa < sb ? -1 : 1);
                    });
                }
                return { type: ValueType.Void };
            },
            arr_indexof: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_indexof" }] };
                const target = args[1];
                const idx = args[0].value.findIndex((v: any) => hankEquals(v, target));
                return idx === -1 ? { type: ValueType.Void } : { type: ValueType.Number, value: idx };
            },
            arr_each: (args, ctx) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_each" }] };
                const items = [...args[0].value];
                const task = args[1];
                for (let i = 0; i < items.length; i++) {
                    const res = ctx.call(task, [items[i], { type: ValueType.Number, value: i }]);
                    if (res.type === ValueType.Opaque && res.label === '__ControlFlow' && String(res.value) === 'Break') break;
                    if (ctx.isError(res)) return res;
                }
                return { type: ValueType.Void };
            },
            arr_map: (args, ctx) => {
                if (args.length < 2 || args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_map" }] };
                const resArr = [];
                const task = args[1];
                for (let i = 0; i < args[0].value.length; i++) {
                    const res = ctx.call(task, [args[0].value[i], { type: ValueType.Number, value: i }]);
                    if (ctx.isError(res)) return res;
                    resArr.push(res);
                }
                return { type: ValueType.Array, value: resArr };
            },
            arr_filter: (args, ctx) => {
                if (args.length < 2 || args[0].type !== ValueType.Array) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Array" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "arr_filter" }] };
                const resArr = [];
                const task = args[1];
                for (let i = 0; i < args[0].value.length; i++) {
                    const res = ctx.call(task, [args[0].value[i], { type: ValueType.Number, value: i }]);
                    if (ctx.isError(res)) return res;
                    if (res.type !== ValueType.Void) resArr.push(args[0].value[i]);
                }
                return { type: ValueType.Array, value: resArr };
            },

            // map
            map_get: (args) => {
                if (args.length < 2 || args[0].type !== ValueType.Map) return { type: ValueType.Void };
                return args[0].value.get(valToString(args[1])) || { type: ValueType.Void };
            },
            map_set: (args) => {
                if (args.length < 3) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Map) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Map" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "map_set" }] };
                args[0].value.set(valToString(args[1]), args[2]);
                return { type: ValueType.Void };
            },
            map_remove: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Map) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Map" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "map_remove" }] };
                return args[0].value.delete(valToString(args[1])) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
            },
            map_keys: (args) => (args.length > 0 && args[0].type === ValueType.Map) ? { type: ValueType.Array, value: Array.from(args[0].value.keys()).map(k => ({ type: ValueType.String, value: k })) } : { type: ValueType.Void },

            // json
            json_parse: (args) => {
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
            json_stringify: (args) => {
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
            },

            // regex
            regex_parse: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                const s = valToString(args[0]);
                const flags = args.length > 1 ? valToString(args[1]) : "";
                return { type: ValueType.Opaque, label: "RegExp", value: new RegExp(s, flags) };
            },
            regex_match: (args) => {
                if (args.length < 2) return { type: ValueType.Void };
                const s = valToString(args[0]);
                const re = args[1].type === ValueType.Opaque && args[1].label === "RegExp" ? args[1].value : new RegExp(valToString(args[1]));
                return re.test(s) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
            },
            regex_replace: (args) => {
                if (args.length < 3) return { type: ValueType.Void };
                const s = valToString(args[0]);
                const re = args[1].type === ValueType.Opaque && args[1].label === "RegExp" ? args[1].value : new RegExp(valToString(args[1]), 'g');
                const repl = valToString(args[2]);
                return { type: ValueType.String, value: s.replace(re, repl) };
            },

            // err
            err_code: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Error) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Error" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "err_code" }] };
                return { type: ValueType.Number, value: args[0].code };
            },
            err_message: (args, ctx) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Error) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Error" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "err_message" }] };
                const err = args[0];
                const loc = ctx.getLocalization();
                let tmpl = loc[err.code!] || "Unknown Error";
                (err.args || []).forEach((a, i) => {
                    tmpl = tmpl.replace(`{${i}}`, valToString(a));
                });
                return { type: ValueType.String, value: tmpl };
            },
            err_args: (args) => {
                if (args.length === 0) return { type: ValueType.Void };
                if (args[0].type !== ValueType.Error) return { type: ValueType.Error, code: 4007, args: [{ type: ValueType.String, value: "Error" }, { type: ValueType.String, value: typeToString(args[0].type) }, { type: ValueType.String, value: "err_args" }] };
                return { type: ValueType.Array, value: args[0].args || [] };
            },
        };
    }
}
