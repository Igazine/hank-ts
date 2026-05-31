import { Value, ValueType, NativeFunc, IHankExtension, HankError } from '../Types.js';
import { HankErrorRegistry } from '../ErrorRegistry.js';

const SAFE_INT_MAX = BigInt("9007199254740991");

function checkSafeInt(n: number): bigint {
    if (!Number.isFinite(n) || Math.abs(n) > Number(SAFE_INT_MAX)) {
        throw HankErrorRegistry.create(HankError.BitwiseOutOfBounds, [n]);
    }
    return BigInt(Math.trunc(n));
}

function fromSafeInt(n: bigint): number {
    const f = Number(n);
    if (Math.abs(f) > Number(SAFE_INT_MAX)) {
        throw HankErrorRegistry.create(HankError.BitwiseOutOfBounds, [f]);
    }
    return f;
}

export class PlatformExtension implements IHankExtension {
    public readonly name = "PlatformExtension";

    public getTasks(): Record<string, NativeFunc> {
        return {
            bin_and: (args) => {
                const a = (args.length > 0 && args[0].type === ValueType.Number) ? (args[0] as any).value : 0;
                const b = (args.length > 1 && args[1].type === ValueType.Number) ? (args[1] as any).value : 0;
                return { type: ValueType.Number, value: fromSafeInt(checkSafeInt(a) & checkSafeInt(b)) };
            },
            bin_or: (args) => {
                const a = (args.length > 0 && args[0].type === ValueType.Number) ? (args[0] as any).value : 0;
                const b = (args.length > 1 && args[1].type === ValueType.Number) ? (args[1] as any).value : 0;
                return { type: ValueType.Number, value: fromSafeInt(checkSafeInt(a) | checkSafeInt(b)) };
            },
            bin_xor: (args) => {
                const a = (args.length > 0 && args[0].type === ValueType.Number) ? (args[0] as any).value : 0;
                const b = (args.length > 1 && args[1].type === ValueType.Number) ? (args[1] as any).value : 0;
                return { type: ValueType.Number, value: fromSafeInt(checkSafeInt(a) ^ checkSafeInt(b)) };
            },
            bin_not: (args) => {
                const a = (args.length > 0 && args[0].type === ValueType.Number) ? (args[0] as any).value : 0;
                return { type: ValueType.Number, value: fromSafeInt(~checkSafeInt(a)) };
            },
            bin_shiftL: (args) => {
                const a = (args.length > 0 && args[0].type === ValueType.Number) ? (args[0] as any).value : 0;
                const b = (args.length > 1 && args[1].type === ValueType.Number) ? (args[1] as any).value : 0;
                return { type: ValueType.Number, value: fromSafeInt(checkSafeInt(a) << BigInt(Math.trunc(b))) };
            },
            bin_shiftR: (args) => {
                const a = (args.length > 0 && args[0].type === ValueType.Number) ? (args[0] as any).value : 0;
                const b = (args.length > 1 && args[1].type === ValueType.Number) ? (args[1] as any).value : 0;
                return { type: ValueType.Number, value: fromSafeInt(checkSafeInt(a) >> BigInt(Math.trunc(b))) };
            }
        };
    }
}
