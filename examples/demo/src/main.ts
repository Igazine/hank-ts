import { Runner } from '../../../dist/Runner.js';
import { StdLib } from '../../../dist/stdlib/index.js';
import { Value, ValueType } from '../../../dist/Types.js';
import { FileResource } from './FileResource.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const args = process.argv.slice(2);
    
    // Submodule is at vendor/hank relative to the hank-ts root.
    const current = process.cwd();
    let workspaceRoot = path.resolve(current, 'vendor/hank');
    if (!fs.existsSync(workspaceRoot)) {
        workspaceRoot = path.resolve(current, '../../vendor/hank');
    }

    if (args.length === 0) {
        await runConformance(workspaceRoot);
        return;
    }

    const runner = createRunner();
    const scriptPath = path.isAbsolute(args[0]) ? args[0] : path.resolve(current, args[0]);
    const resource = FileResource.create(scriptPath);

    const hankArgs: Value[] = [];
    for (let i = 1; i < args.length; i++) {
        hankArgs.push({ type: ValueType.String, value: args[i] });
    }

    try {
        const res = await runner.run(resource, hankArgs);
        if (res.type === ValueType.Error) {
            const loc = runner.localization;
            let tmpl = loc[res.code!] || "Unknown Error";
            (res.args || []).forEach((a, i) => {
                tmpl = tmpl.replace(`{${i}}`, String(a.value || "Void"));
            });
            process.stderr.write(`Error ${res.code}: ${tmpl}\n`);
            process.exit(1);
        }
        if (res.type === ValueType.Number) {
            process.exit(Math.floor(res.value));
        }
        process.exit(0);
    } catch (e: any) {
        handleError(e);
        process.exit(1);
    }
}

function handleError(e: any) {
    if (e.message) {
        process.stderr.write(e.message + "\n");
    } else {
        process.stderr.write(String(e) + "\n");
    }
}

function createRunner(options?: any): Runner {
    const runner = new Runner(options);

    // 0. Register Localization
    runner.registerLocalization({
        4001: "Target is not a function: {0}",
        4007: "Type Mismatch: Expected {0}, got {1} in {2}",
        4005: "Value exceeds safe integer bounds: {0} in {1}",
        4008: "Instruction Limit Exceeded: Script reached the maximum allowed AST evaluations ({0})"
    });

    // Register Extensions
    runner.registerExtension(new StdLib());

    return runner;
}

async function runConformance(workspaceRoot: string) {
    const tests = [
        "test/conformance/01_literals.hank",
        "test/conformance/02_gates.hank",
        "test/conformance/03_scoping.hank",
        "test/conformance/04_hoisting.hank",
        "test/conformance/05_params.hank",
        "test/conformance/06_macros.hank",
        "test/conformance/07_returns.hank",
        "test/conformance/08_host_args.hank",
        "test/conformance/09_deep_nesting.hank",
        "test/conformance/10_edge_cases.hank",
        "test/conformance/11_regex_parse.hank",
        "test/conformance/12_data_advanced.hank",
        "test/conformance/13_logic_module.hank",
        "test/conformance/15_logic_eq.hank",
        "test/conformance/16_chained_assign.hank",
        "test/conformance/17_num_module.hank",
        "test/conformance/18_runtime_module.hank",
        "test/conformance/19_error_handling.hank",
        "test/conformance/20_grammar_hardening.hank",
        "test/conformance/21_data_functional.hank",
        "test/conformance/22_instruction_limit.hank",
    ];

    for (const t of tests) {
        console.log(`--- Running Conformance: ${t} ---`);
        const opts = t.includes("22_instruction_limit") ? { maxInstructions: 1000 } : undefined;
        const runner = createRunner(opts);
        const testPath = path.resolve(workspaceRoot, t);
        const resource = FileResource.create(testPath);
        const args: Value[] = [];
        if (t.endsWith("08_host_args.hank")) {
            args.push({ type: ValueType.String, value: "Tamas" });
        }
        try {
            const res = await runner.run(resource, args);
            if (res.type === ValueType.Error) {
                const loc = runner.localization;
                let tmpl = loc[res.code!] || "Unknown Error";
                (res.args || []).forEach((a, i) => {
                    tmpl = tmpl.replace(`{${i}}`, String(a.value || "Void"));
                });
                process.stderr.write(`Error ${res.code}: ${tmpl}\n`);
            }
        } catch (e) {
            handleError(e);
        }
        console.log('--------------------\n');
    }
}

main().catch(console.error);
