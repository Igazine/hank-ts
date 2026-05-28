import { Interpreter, HankScope } from './Interpreter.js';
import { Lexer } from './Lexer.js';
import { Parser } from './Parser.js';
import { ValueType } from './Types.js';
/**
 * A Hank Host Runner.
 * Handles resource orchestration, macro resolution, and AST caching.
 * Platform-agnostic: uses the Resource model for all content retrieval.
 */
export class Runner {
    resourceCache = new Map();
    coreScope = new HankScope();
    constructor() { }
    /**
     * Registers a set of native tasks under a module name.
     */
    registerModule(name, tasks) {
        const moduleObj = new Map();
        for (const [tName, native] of Object.entries(tasks)) {
            moduleObj.set(tName, {
                type: ValueType.Task,
                task: { isNative: true, name: `${name}.${tName}`, native }
            });
        }
        this.coreScope.set(name, { type: ValueType.Object, value: moduleObj });
    }
    /**
     * Pre-loads and caches a resource for execution.
     */
    async load(resource, stack = []) {
        // Check cache
        const cached = this.resourceCache.get(resource.id);
        if (cached && cached.ast)
            return cached.ast;
        // Circular Dependency Check
        if (stack.includes(resource.id))
            throw new Error(`Circular Dependency: ${resource.id}`);
        // Reconcile with cache
        const activeResource = cached || resource;
        if (!cached) {
            this.resourceCache.set(resource.id, resource);
        }
        await activeResource.load();
        if (activeResource.content === null)
            throw new Error(`Resource content not loaded: ${activeResource.id}`);
        const newStack = [...stack, activeResource.id];
        const lexer = new Lexer(activeResource.content);
        const tokens = lexer.tokenize();
        const parser = new Parser(tokens, activeResource.id, (macroPath) => {
            const mRes = activeResource.resolve(macroPath);
            // Note: Since load is async and Parser is sync, we need a strategy here.
            // For now, we'll assume sync loading for local resources, or we might need to 
            // make the Parser aware of the resource tree if we want true async macros.
            // However, Haxe/Go are sync in their parser.
            // Let's implement a sync-compatible load if possible, or wait for the resource.
            // In Node.js, we can often read sync.
            const result = this.loadSync(mRes, newStack);
            return result;
        });
        const ast = parser.parse();
        activeResource.ast = ast;
        return ast;
    }
    /**
     * Synchronous version of load for macro resolution.
     */
    loadSync(resource, stack) {
        const cached = this.resourceCache.get(resource.id);
        if (cached && cached.ast)
            return cached.ast;
        if (stack.includes(resource.id))
            throw new Error(`Circular Dependency: ${resource.id}`);
        const activeResource = cached || resource;
        if (!cached)
            this.resourceCache.set(resource.id, resource);
        // This requires the resource.load() to be capable of sync execution.
        // We'll call it and hope for the best, or check if it returns a Promise.
        const loadResult = activeResource.load();
        if (loadResult instanceof Promise) {
            throw new Error(`Asynchronous macro loading detected for ${resource.id}. TS Runner requires sync resolution for macros.`);
        }
        if (activeResource.content === null)
            throw new Error(`Resource content not loaded: ${activeResource.id}`);
        const newStack = [...stack, activeResource.id];
        const lexer = new Lexer(activeResource.content);
        const parser = new Parser(lexer.tokenize(), activeResource.id, (macroPath) => {
            const mRes = activeResource.resolve(macroPath);
            return this.loadSync(mRes, newStack);
        });
        const ast = parser.parse();
        activeResource.ast = ast;
        return ast;
    }
    /**
     * Removes a resource from the cache.
     */
    unload(resource) {
        this.resourceCache.delete(resource.id);
    }
    /**
     * Executes a Hank Resource.
     */
    async run(resource, args = []) {
        const ast = await this.load(resource);
        const interpreter = new Interpreter(undefined, this.coreScope);
        const scriptTask = interpreter.run(ast);
        if (scriptTask.type !== ValueType.Task) {
            throw new Error("Hank Error: Script must evaluate to a Task definition.");
        }
        return interpreter.call(scriptTask, args);
    }
}
