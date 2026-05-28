import { 
    Value, 
    ValueType, 
    Runner,
    StdLib
} from '../../../src/index.js';
import { FileResource } from './FileResource.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cp from 'node:child_process';
import * as os from 'node:os';

async function main() {
    const args = process.argv.slice(2);
    const runner = createRunner();

    if (args.length === 0) {
        await runConformance(runner);
        return;
    }

    const scriptPath = path.isAbsolute(args[0]) ? args[0] : path.resolve(process.cwd(), args[0]);
    const resource = FileResource.create(scriptPath);
    const hankArgs: Value[] = args.slice(1).map(a => ({ type: ValueType.String, value: a }));

    try {
        const val = await runner.run(resource, hankArgs);
        if (val.type === ValueType.Number) {
            process.exit(val.value);
        }
        process.exit(0);
    } catch (e: any) {
        console.error(e.message || e);
        process.exit(1);
    }
}

function createRunner(): Runner {
    const runner = new Runner();
    
    // 1. Register Standard Library modules manually
    const std = StdLib.getModules();
    for (const [name, tasks] of Object.entries(std)) {
        runner.registerModule(name, tasks);
    }

    // 2. Register Example SYSLIB modules
    registerSyslib(runner);

    return runner;
}

function registerSyslib(runner: Runner) {
    runner.registerModule('os', {
        type: () => ({ type: ValueType.String, value: process.platform }),
        name: () => ({ type: ValueType.String, value: process.platform }),
        arch: () => ({ type: ValueType.String, value: process.arch }),
        memory: () => {
            const map = new Map<string, Value>();
            map.set('total', { type: ValueType.Number, value: os.totalmem() });
            map.set('free', { type: ValueType.Number, value: os.freemem() });
            map.set('used', { type: ValueType.Number, value: os.totalmem() - os.freemem() });
            return { type: ValueType.Object, value: map };
        },
        cpu: () => ({ type: ValueType.Number, value: os.loadavg()[0] })
    });

    runner.registerModule('host', {
        cwd: () => ({ type: ValueType.String, value: process.cwd() }),
        pid: () => ({ type: ValueType.Number, value: process.pid }),
        isRoot: () => (process.getuid?.() === 0 ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void })
    });

    runner.registerModule('fs', {
        exists: (args) => {
            const p = (args[0] as any).value;
            return fs.existsSync(p) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
        },
        read: (args) => {
            const p = (args[0] as any).value;
            try {
                return { type: ValueType.String, value: fs.readFileSync(p, 'utf-8') };
            } catch (e) { return { type: ValueType.Void }; }
        },
        write: (args) => {
            const p = (args[0] as any).value;
            const c = (args[1] as any).value;
            try {
                fs.writeFileSync(p, c);
                return { type: ValueType.Number, value: 1 };
            } catch (e) { return { type: ValueType.Void }; }
        },
        deleteFile: (args) => {
            const p = (args[0] as any).value;
            try {
                fs.unlinkSync(p);
                return { type: ValueType.Number, value: 1 };
            } catch (e) { return { type: ValueType.Void }; }
        },
        stat: (args) => {
            const p = (args[0] as any).value;
            try {
                const s = fs.statSync(p);
                const map = new Map<string, Value>();
                map.set('size', { type: ValueType.Number, value: s.size });
                map.set('mtime', { type: ValueType.Number, value: s.mtimeMs });
                map.set('isDir', s.isDirectory() ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void });
                return { type: ValueType.Object, value: map };
            } catch (e) { return { type: ValueType.Void }; }
        }
    });

    runner.registerModule('proc', {
        run: (args) => {
            const cmd = (args[0] as any).value;
            const cmdArgs = args[1]?.type === ValueType.Array ? args[1].value.map((a: any) => a.value) : [];
            try {
                const res = cp.spawnSync(cmd, cmdArgs, { encoding: 'utf-8' });
                const map = new Map<string, Value>();
                map.set('code', { type: ValueType.Number, value: res.status ?? 0 });
                map.set('stdout', { type: ValueType.String, value: res.stdout });
                map.set('stderr', { type: ValueType.String, value: res.stderr });
                return { type: ValueType.Object, value: map };
            } catch (e: any) {
                const map = new Map<string, Value>();
                map.set('code', { type: ValueType.Number, value: 1 });
                map.set('stdout', { type: ValueType.String, value: '' });
                map.set('stderr', { type: ValueType.String, value: e.toString() });
                return { type: ValueType.Object, value: map };
            }
        }
    });
}

async function runConformance(runner: Runner) {
    const root = process.cwd();
    let workspaceRoot = path.resolve(root, 'vendor/hank');
    if (!fs.existsSync(workspaceRoot)) {
        workspaceRoot = path.resolve(root, '../../vendor/hank');
    }
    
    const tests = [
        'test/conformance/01_literals.hank',
        'test/conformance/02_gates.hank',
        'test/conformance/03_scoping.hank',
        'test/conformance/04_hoisting.hank',
        'test/conformance/05_params.hank',
        'test/conformance/06_macros.hank',
        'test/conformance/07_returns.hank',
        'test/conformance/08_host_args.hank',
        'test/conformance/09_deep_nesting.hank',
        'test/conformance/10_edge_cases.hank',
        'test/conformance/11_regex_parse.hank',
        'test/conformance/12_data_advanced.hank',
        'test/conformance/13_logic_module.hank',
        'test/conformance/14_syslib_hank.hank',
        'test/conformance/15_logic_eq.hank',
        'test/conformance/16_chained_assign.hank',
        'test/conformance/17_num_module.hank',
    ];
    for (const t of tests) {
        console.log(`--- Running: ${t} ---`);
        const fullPath = path.join(workspaceRoot, t);
        const resource = FileResource.create(fullPath);
        const args: Value[] = t.endsWith('08_host_args.hank') ? [{ type: ValueType.String, value: 'Tamas' }] : [];
        try { 
            await runner.run(resource, args); 
        } catch (e: any) { 
            console.log(`Test Failed: ${e.message || e}`); 
        }
        console.log('--------------------\n');
    }
}

main();
