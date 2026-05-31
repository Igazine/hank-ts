export var ValueType;
(function (ValueType) {
    ValueType[ValueType["Void"] = 0] = "Void";
    ValueType[ValueType["Number"] = 1] = "Number";
    ValueType[ValueType["String"] = 2] = "String";
    ValueType[ValueType["Array"] = 3] = "Array";
    ValueType[ValueType["Map"] = 4] = "Map";
    ValueType[ValueType["Opaque"] = 5] = "Opaque";
    ValueType[ValueType["Task"] = 6] = "Task";
    ValueType[ValueType["Error"] = 7] = "Error";
})(ValueType || (ValueType = {}));
/**
 * A base class for all Hank resources.
 * Encapsulates the unique identity, raw content, and parsed AST of a script.
 */
export class Resource {
    content = null;
    id;
    ast = null;
    constructor(id) {
        this.id = id;
    }
}
export var HankError;
(function (HankError) {
    // Lexical Errors (10xx)
    HankError[HankError["UnexpectedCharacter"] = 1001] = "UnexpectedCharacter";
    HankError[HankError["UnclosedStringLiteral"] = 1002] = "UnclosedStringLiteral";
    // Syntax Errors (20xx)
    HankError[HankError["EmptyScript"] = 2001] = "EmptyScript";
    HankError[HankError["ExpectedMainTask"] = 2002] = "ExpectedMainTask";
    HankError[HankError["UnexpectedCodeOutsideMainTask"] = 2003] = "UnexpectedCodeOutsideMainTask";
    HankError[HankError["InvalidAssignmentTarget"] = 2004] = "InvalidAssignmentTarget";
    HankError[HankError["UnexpectedToken"] = 2005] = "UnexpectedToken";
    HankError[HankError["MacroRequiresString"] = 2006] = "MacroRequiresString";
    HankError[HankError["ExpectedIdentifier"] = 2007] = "ExpectedIdentifier";
    // Resolution & Runner Errors (30xx)
    HankError[HankError["CircularDependency"] = 3001] = "CircularDependency";
    HankError[HankError["ResourceContentNotLoaded"] = 3002] = "ResourceContentNotLoaded";
    HankError[HankError["ScriptMustBeTask"] = 3003] = "ScriptMustBeTask";
    HankError[HankError["MacroResourceNotFound"] = 3004] = "MacroResourceNotFound";
    // Runtime Errors (40xx)
    HankError[HankError["TargetNotFunction"] = 4001] = "TargetNotFunction";
    HankError[HankError["TooManyArguments"] = 4002] = "TooManyArguments";
    HankError[HankError["MissingRequiredParameter"] = 4003] = "MissingRequiredParameter";
    HankError[HankError["Halt"] = 4004] = "Halt";
    HankError[HankError["BitwiseOutOfBounds"] = 4005] = "BitwiseOutOfBounds";
    HankError[HankError["GenericRuntimeError"] = 4006] = "GenericRuntimeError";
    HankError[HankError["TypeMismatch"] = 4007] = "TypeMismatch";
    HankError[HankError["InstructionLimitExceeded"] = 4008] = "InstructionLimitExceeded";
})(HankError || (HankError = {}));
export class HankErrorValue extends Error {
    code;
    message;
    filename;
    line;
    column;
    lineText;
    constructor(code, message, filename, line, column, lineText) {
        super(message);
        this.code = code;
        this.message = message;
        this.filename = filename;
        this.line = line;
        this.column = column;
        this.lineText = lineText;
        this.name = 'HankError';
    }
}
