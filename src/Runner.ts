import { Interpreter, HankScope } from './Interpreter.js';
import { Lexer, TokenType } from './Lexer.js';
import { Parser } from './Parser.js';
import { Value, ValueType, Scope, NativeFunc, Expr, Resource, HankError, IHankExtension } from './Types.js';
import { HankErrorRegistry } from './ErrorRegistry.js';

/**
 * A Hank Host Runner.
 * Handles resource orchestration, macro resolution, and AST caching.
 * Platform-agnostic: uses the Resource model for all content retrieval.
 */
export class Runner {
    private resourceCache: Map<string, Resource> = new Map();
    public coreScope: Scope = new HankScope();

    constructor() {}

    /**
     * Registers a set of native tasks under a module name.
     */
    registerModule(name: string, tasks: Record<string, NativeFunc>) {
        const moduleObj = new Map<string, Value>();
        for (const [tName, native] of Object.entries(tasks)) {
            moduleObj.set(tName, {
                type: ValueType.Task,
                task: { isNative: true, name: `${name}.${tName}`, native }
            });
        }
        this.coreScope.set(name, { type: ValueType.Object, value: moduleObj });
    }

    /**
     * Registers a Hank Extension and all its modules.
     */
    registerExtension(ext: IHankExtension) {
        const mods = ext.getModules();
        for (const [name, tasks] of Object.entries(mods)) {
            this.registerModule(name, tasks);
        }
    }

    /**
     * Pre-loads and caches a resource for execution.
     */
    async load(resource: Resource, stack: string[] = []): Promise<Expr> {
        // Check cache
        const cached = this.resourceCache.get(resource.id);
        if (cached && cached.ast) return cached.ast;

        // Circular Dependency Check
        if (stack.includes(resource.id)) {
            throw HankErrorRegistry.create(HankError.CircularDependency, [resource.id]);
        }

        // Reconcile with cache
        const activeResource = cached || resource;
        if (!cached) {
            this.resourceCache.set(resource.id, resource);
        }

        await activeResource.load();
        if (activeResource.content === null) {
            throw HankErrorRegistry.create(HankError.ResourceContentNotLoaded, [activeResource.id]);
        }

        const newStack = [...stack, activeResource.id];

        const lexer = new Lexer(activeResource.content);
        const tokens = lexer.tokenize();
        const parser = new Parser(tokens, activeResource.id, (macroPath: string) => {
            const mRes = activeResource.resolve(macroPath);
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
    private loadSync(resource: Resource, stack: string[]): Expr {
        const cached = this.resourceCache.get(resource.id);
        if (cached && cached.ast) return cached.ast;
        if (stack.includes(resource.id)) {
            throw HankErrorRegistry.create(HankError.CircularDependency, [resource.id]);
        }

        const activeResource = cached || resource;
        if (!cached) this.resourceCache.set(resource.id, resource);

        const loadResult = activeResource.load();
        if (loadResult instanceof Promise) {
            throw new Error(`Asynchronous macro loading detected for ${resource.id}. TS Runner requires sync resolution for macros.`);
        }

        if (activeResource.content === null) {
            throw HankErrorRegistry.create(HankError.ResourceContentNotLoaded, [activeResource.id]);
        }

        const newStack = [...stack, activeResource.id];
        const lexer = new Lexer(activeResource.content);
        const parser = new Parser(lexer.tokenize(), activeResource.id, (macroPath: string) => {
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
    unload(resource: Resource) {
        this.resourceCache.delete(resource.id);
    }

    /**
     * Executes a Hank Resource.
     */
    async run(resource: Resource, args: Value[] = []): Promise<Value> {
        const ast = await this.load(resource);

        const interpreter = new Interpreter(undefined, this.coreScope);
        const scriptTask = interpreter.run(ast);

        if (scriptTask.type !== ValueType.Task) {
            throw HankErrorRegistry.create(HankError.ScriptMustBeTask);
        }

        return interpreter.call(scriptTask, args);
    }
}
