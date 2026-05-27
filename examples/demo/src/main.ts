import { 
    Value, 
    ValueType, 
    Runner,
    StdLib
} from '@igazine/hal';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cp from 'node:child_process';

class DemoRunner extends Runner {
    protected readFile(p: string): string {
        return fs.readFileSync(p, 'utf-8');
    }

    protected resolvePath(m: string, baseFile: string): string {
        if (path.isAbsolute(m)) return m;
        
        // baseFile is the full path of the script currently being processed
        const baseDir = baseFile === '' ? process.cwd() : path.dirname(baseFile);
        let joined = path.resolve(baseDir, m);
        
        if (!path.extname(joined)) {
            if (fs.existsSync(joined + '.hal')) return joined + '.hal';
        }
        return joined;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const runner = new DemoRunner();
    
    // 1. Register Standard Library modules manually (Optional)
    const std = StdLib.getModules();
    for (const [name, tasks] of Object.entries(std)) {
        runner.registerModule(name, tasks);
    }

    // 2. Register Example SYSLIB modules
    registerSyslib(runner);

    if (args.length === 0) {
        await runConformance(runner);
        return;
    }

    const halArgs: Value[] = args.slice(1).map(a => ({ type: ValueType.String, value: a }));
    try {
        const val = runner.run(args[0], halArgs);
        if (val.type === ValueType.Number) {
            process.exit(val.value);
        }
        process.exit(0);
    } catch (e: any) {
        console.error(e.message || e);
        process.exit(1);
    }
}

function registerSyslib(runner: DemoRunner) {
    runner.registerModule('os', {
        type: () => ({ type: ValueType.String, value: process.platform }),
        name: () => ({ type: ValueType.String, value: process.platform }),
        arch: () => ({ type: ValueType.String, value: process.arch })
    });

    runner.registerModule('host', {
        cwd: () => ({ type: ValueType.String, value: process.cwd() }),
        pid: () => ({ type: ValueType.Number, value: process.pid }),
        isRoot: () => (process.getuid?.() === 0 ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void }),
        signal: (args: Value[]) => {
            if (args.length > 0) {
                console.log(`[SIGNAL] ${(args[0] as any).value || 'null'}`);
            }
            return { type: ValueType.Void };
        }
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

async function runConformance(runner: DemoRunner) {
    const root = process.cwd();
    const workspaceRoot = path.resolve(root, '../../vendor/hal');
    
    const tests = [
        'test/conformance/01_literals.hal',
        'test/conformance/02_gates.hal',
        'test/conformance/03_scoping.hal',
        'test/conformance/04_hoisting.hal',
        'test/conformance/05_params.hal',
        'test/conformance/06_macros.hal',
        'test/conformance/07_returns.hal',
        'test/conformance/08_host_args.hal',
        'test/conformance/09_deep_nesting.hal',
        'test/conformance/10_edge_cases.hal',
        'test/conformance/11_regex_parse.hal',
        'test/conformance/12_data_advanced.hal',
        'test/conformance/13_logic_module.hal',
    ];
    for (const t of tests) {
        console.log(`--- Running: ${t} ---`);
        const fullPath = path.join(workspaceRoot, t);
        const args: Value[] = t.endsWith('08_host_args.hal') ? [{ type: ValueType.String, value: 'Tamas' }] : [];
        try { runner.run(fullPath, args); } catch (e: any) { console.log(`Test Failed: ${e.message || e}`); }
        console.log('--------------------\n');
    }
}

main();
