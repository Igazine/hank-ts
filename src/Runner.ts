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
    private macroMap: Map<string, Expr> = new Map();
    public coreScope: Scope = new HankScope();
    public localization: Record<number, string> = {};

    constructor() {}

    /**
     * Registers a localization map (Code -> Template).
     */
    registerLocalization(map: Record<number, string>) {
        for (const [code, tmpl] of Object.entries(map)) {
            this.localization[Number(code)] = tmpl;
        }
    }

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

        // Cache first, then load
        if (!cached) {
            this.resourceCache.set(resource.id, resource);
        }
        const activeResource = cached || resource;

        await activeResource.load();
        if (activeResource.content === null) {
            throw HankErrorRegistry.create(HankError.ResourceContentNotLoaded, [activeResource.id]);
        }

        const newStack = [...stack, activeResource.id];

        const lexer = new Lexer(activeResource.content);
        const parser = new Parser(lexer.tokenize(), activeResource.id, (macroPath) => {
            const mRes = activeResource.resolve(macroPath);
            // This is problematic in a sync constructor.
            // But we know that Runner.load is called recursively before Parser.parse.
            // So the macro SHOULD already be in the cache? No, not necessarily.
            
            // Wait, HAL says the Parser MUST request the resource from the Runner.
            // In TS, we'll just throw if it's not pre-loaded, which is what Runner should do.
            const resolved = activeResource.resolve(macroPath);
            const found = this.resourceCache.get(resolved.id);
            if (!found || !found.ast) throw new Error(`Macro not pre-loaded: ${macroPath}`);
            return found.ast;
        });

        // Pre-scan for macros to ensure they are loaded before parsing
        const tokens = lexer.tokenize();
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === TokenType.At && tokens[i+1]?.type === TokenType.String) {
                const macroPath = tokens[i+1].literal;
                const mRes = activeResource.resolve(macroPath);
                await this.load(mRes, newStack);
            }
        }

        activeResource.ast = parser.parse();
        return activeResource.ast;
    }

    /**
     * Removes a resource and its AST from the cache.
     */
    unload(resource: Resource) {
        this.resourceCache.delete(resource.id);
    }

    /**
     * Executes a Hank Resource.
     */
    async run(resource: Resource, args: Value[] = []): Promise<Value> {
        const ast = await this.load(resource);

        const interpreter = new Interpreter(undefined, this.coreScope, this.localization);
        const scriptTask = interpreter.run(ast);

        if (scriptTask.type === ValueType.Task) {
            return interpreter.call(scriptTask, args);
        } else if (scriptTask.type === ValueType.Error) {
            return scriptTask;
        }

        throw HankErrorRegistry.create(HankError.ScriptMustBeTask);
    }
}
