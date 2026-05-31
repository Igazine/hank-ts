export enum ValueType {
    Void,
    Number,
    String,
    Array,
    Map,
    Opaque,
    Task,
    Error
}

export interface Value {
    type: ValueType;
    value?: any;
    label?: string; // For Opaque
    task?: TaskValue;
    code?: number; // For Error
    args?: Value[]; // For Error
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
    isError(val: Value): boolean;
    getLocalization(): Record<number, string>;
    scope: Scope;
}

export interface Scope {
    get(name: string): Value;
    set(name: string, val: Value): void;
    exists(name: string): boolean;
}

/**
 * A base class for all Hank resources.
 * Encapsulates the unique identity, raw content, and parsed AST of a script.
 */
export abstract class Resource {
    public content: string | null = null;
    public id: string;
    public ast: Expr | null = null;

    constructor(id: string) {
        this.id = id;
    }

    /**
     * Fulfills the raw content of the resource from its source.
     */
    abstract load(): Promise<void> | void;

    /**
     * Resolves a relative identifier into a new Resource instance.
     * @param id The string identifier (e.g., from a @ macro).
     */
    abstract resolve(id: string): Resource;
}

export type Expr =
    | { kind: 'Block', stmts: Expr[], td: TokenData }
    | { kind: 'Assign', name: string, value: Expr, td: TokenData }
    | { kind: 'Literal', value: Value, td: TokenData }
    | { kind: 'Ident', name: string, isCore: boolean, td: TokenData }
    | { kind: 'FuncDef', params: Param[], body: Expr, td: TokenData }
    | { kind: 'FuncCall', target: Expr, args: Expr[], td: TokenData }
    | { kind: 'UnOp', op: string, target: Expr, td: TokenData }
    | { kind: 'Map', fields: Map<string, Expr>, td: TokenData }
    | { kind: 'Array', items: Expr[], td: TokenData }
    | { kind: 'FlowControl', condition: Expr, success: Expr, fallback?: Expr, rescue?: Expr, catchVar?: string, td: TokenData }
    | { kind: 'Error', code: number, args: Expr[], td: TokenData };

export interface TokenData {
    line: number;
    column: number;
    lineText: string;
    filename?: string;
}

export interface IHankSerializable {
    serializeHank(): string;
}

export interface IHankExtension {
    readonly name: string;
    getTasks(): Record<string, NativeFunc>;
}

export enum HankError {
    // Lexical Errors (10xx)
    UnexpectedCharacter = 1001,
    UnclosedStringLiteral = 1002,

    // Syntax Errors (20xx)
    EmptyScript = 2001,
    ExpectedMainTask = 2002,
    UnexpectedCodeOutsideMainTask = 2003,
    InvalidAssignmentTarget = 2004,
    UnexpectedToken = 2005,
    MacroRequiresString = 2006,
    ExpectedIdentifier = 2007,

    // Resolution & Runner Errors (30xx)
    CircularDependency = 3001,
    ResourceContentNotLoaded = 3002,
    ScriptMustBeTask = 3003,
    MacroResourceNotFound = 3004,

    // Runtime Errors (40xx)
    TargetNotFunction = 4001,
    TooManyArguments = 4002,
    MissingRequiredParameter = 4003,
    Halt = 4004,
    BitwiseOutOfBounds = 4005,
    GenericRuntimeError = 4006,
    TypeMismatch = 4007,
    InstructionLimitExceeded = 4008
    }

export class HankErrorValue extends Error {
    constructor(
        public code: HankError, 
        public message: string,
        public filename?: string,
        public line?: number,
        public column?: number,
        public lineText?: string
    ) {
        super(message);
        this.name = 'HankError';
    }
}
