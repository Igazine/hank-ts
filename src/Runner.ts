import { Interpreter, HankScope } from './Interpreter.js';
import { Lexer, TokenType } from './Lexer.js';
import { Parser } from './Parser.js';
import { Value, ValueType, Scope, NativeFunc, Expr } from './Types.js';

/**
 * A base class for Hank Host Runners.
 * Handles script loading, macro resolution, and AST caching.
 * Must be extended by environment-specific implementations (e.g. Node, Browser).
 */
export abstract class Runner {
    private pathCache: Map<string, string> = new Map();
    private astCache: Map<string, Expr> = new Map();
    private macroMap: Map<string, string> = new Map();
    public coreScope: Scope = new HankScope();

    constructor() {}

    /**
     * Reads a file from the host environment.
     */
    protected abstract readFile(path: string): string;

    /**
     * Resolves a macro path relative to the current file.
     */
    protected abstract resolvePath(macroPath: string, baseFile: string): string;

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
     * Pre-loads and caches a script for execution.
     */
    load(scriptPath: string): string {
        const absPath = this.resolvePath(scriptPath, '');
        if (this.astCache.has(absPath)) return absPath;
        
        this.preprocess(absPath, []);

        const content = this.pathCache.get(absPath);
        if (!content) throw new Error(`File not loaded: ${absPath}`);

        const lexer = new Lexer(content);
        const tokens = lexer.tokenize();
        const parser = new Parser(tokens, absPath, this.macroMap);
        const ast = parser.parse();
        this.astCache.set(absPath, ast);
        return absPath;
    }

    /**
     * Removes a script from the cache.
     */
    unload(scriptPath: string) {
        const absPath = this.resolvePath(scriptPath, '');
        this.astCache.delete(absPath);
        this.pathCache.delete(absPath);
    }

    /**
     * Executes a Hank script.
     */
    run(scriptPath: string, args: Value[] = []): Value {
        const absPath = this.load(scriptPath);
        const ast = this.astCache.get(absPath)!;

        const interpreter = new Interpreter(undefined, this.coreScope);
        const scriptTask = interpreter.run(ast);

        if (scriptTask.type !== ValueType.Task) {
            throw new Error("Hank Error: Script must evaluate to a Task definition.");
        }

        return interpreter.call(scriptTask, args);
    }

    private preprocess(filePath: string, stack: string[]) {
        if (stack.includes(filePath)) throw new Error(`Circular Dependency: ${filePath}`);
        if (this.pathCache.has(filePath)) return;
        
        const content = this.readFile(filePath);
        this.pathCache.set(filePath, content);
        const newStack = [...stack, filePath];
        
        const macros = this.scanMacros(content);
        for (const m of macros) {
            const mPath = this.resolvePath(m, filePath);
            this.preprocess(mPath, newStack);
            this.macroMap.set(m, this.pathCache.get(mPath)!);
        }
    }

    private scanMacros(content: string): string[] {
        const lexer = new Lexer(content);
        const tokens = lexer.tokenize();
        const macros: string[] = [];
        for (let i = 0; i < tokens.length - 1; i++) {
            if (tokens[i].type === TokenType.At) {
                const next = tokens[i + 1];
                if (next.type === TokenType.Identifier || next.type === TokenType.String) {
                    macros.push(next.literal);
                }
            }
        }
        return macros;
    }
}
