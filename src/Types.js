export var ValueType;
(function (ValueType) {
    ValueType[ValueType["Void"] = 0] = "Void";
    ValueType[ValueType["Number"] = 1] = "Number";
    ValueType[ValueType["String"] = 2] = "String";
    ValueType[ValueType["Array"] = 3] = "Array";
    ValueType[ValueType["Object"] = 4] = "Object";
    ValueType[ValueType["Opaque"] = 5] = "Opaque";
    ValueType[ValueType["Task"] = 6] = "Task";
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
