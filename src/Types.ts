export enum ValueType {
    Void,
    Number,
    String,
    Array,
    Object,
    Opaque,
    Task
}

export interface Value {
    type: ValueType;
    value?: any;
    label?: string; // For Opaque
    task?: TaskValue;
}

export interface TaskValue {
    isNative: boolean;
    name: string;
    params?: Param[];
    body?: Expr;
    closure?: Scope;
    native?: NativeFunc;
}

export interface Param {
    name: string;
    isOptional: boolean;
    defaultValue?: Expr;
}

export type NativeFunc = (args: Value[], ctx: ExecutionContext) => Value;

export interface ExecutionContext {
    call(task: Value, args: Value[]): Value;
    eval(node: Expr): Value;
    scope: Scope;
}

export interface Scope {
    get(name: string): Value;
    set(name: string, val: Value): void;
    exists(name: string): boolean;
}

export type Expr =
    | { kind: 'Block', stmts: Expr[], td: TokenData }
    | { kind: 'Assign', name: string, value: Expr, td: TokenData }
    | { kind: 'Literal', value: Value, td: TokenData }
    | { kind: 'Ident', name: string, isCore: boolean, td: TokenData }
    | { kind: 'Field', object: Expr, fieldName: string, td: TokenData }
    | { kind: 'FuncDef', params: Param[], body: Expr, td: TokenData }
    | { kind: 'FuncCall', target: Expr, args: Expr[], td: TokenData }
    | { kind: 'UnOp', op: string, target: Expr, td: TokenData }
    | { kind: 'Object', fields: Map<string, Expr>, td: TokenData }
    | { kind: 'Array', items: Expr[], td: TokenData }
    | { kind: 'FlowControl', condition: Expr, success: Expr, fallback?: Expr, rescue?: Expr, catchVar?: string, td: TokenData };

export interface TokenData {
    line: number;
    lineText: string;
}

export interface IHankSerializable {
    serializeHank(): string;
}
