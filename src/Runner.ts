import { Interpreter, HankScope } from './Interpreter.js';
import { Lexer, TokenType } from './Lexer.js';
import { Parser } from './Parser.js';
import { Value, ValueType, Scope, NativeFunc, Expr, Resource, HankError, IHankExtension } from './Types.js';
import { HankErrorRegistry } from './ErrorRegistry.js';

export interface RunnerOptions {
    maxInstructions?: number;
}

/**
 * A Hank Host Runner.
 * Handles resource orchestration, macro resolution, and AST caching.
 * Platform-agnostic: uses the Resource model for all content retrieval.
 */
export class Runner {
    private resourceCache: Map<string, Resource> = new Map();
    public coreScope: Scope = new HankScope();
    public localization: Record<number, string> = {};
    public options: RunnerOptions;

    constructor(options?: RunnerOptions) {
        this.options = options || { maxInstructions: 0 };
    }

    /**
     * Registers a localization map (Code -> Template).
     */
    registerLocalization(map: Record<number, string>) {
        for (const [code, tmpl] of Object.entries(map)) {
            this.localization[Number(code)] = tmpl;
        }
    }

    /**
     * Registers a set of native tasks.
     */
    registerTasks(tasks: Record<string, NativeFunc>) {
        for (const [tName, native] of Object.entries(tasks)) {
            this.coreScope.set(tName, {
                type: ValueType.Task,
                task: { isNative: true, name: tName, native }
            });
        }
    }

    /**
     * Registers a Hank Extension and all its tasks.
     */
    registerExtension(ext: IHankExtension) {
        this.registerTasks(ext.getTasks());
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
            const found = this.resourceCache.get(mRes.id);
            if (!found || !found.ast) throw new Error(`Macro not pre-loaded: ${macroPath}`);
            return found.ast;
        });

        // Pre-scan for macros
        const tokens = lexer.tokenize();
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === TokenType.At && tokens[i+1]?.type === TokenType.String) {
                const macroPath = tokens[i+1].literal;
                const mRes = activeResource.resolve(macroPath);
                await this.load(mRes, newStack);
            }
        }

        activeResource.ast = await parser.parse();
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

        const interpreter = new Interpreter(undefined, this.coreScope, this.localization, this.options.maxInstructions);
        const scriptTask = interpreter.run(ast);

        if (scriptTask.type === ValueType.Task) {
            return interpreter.call(scriptTask, args);
        } else if (scriptTask.type === ValueType.Error) {
            return scriptTask;
        }

        throw HankErrorRegistry.create(HankError.ScriptMustBeTask);
    }
}
