import { Value, ValueType, NativeFunc, IHankExtension } from '../Types.js';

export class SysExtension implements IHankExtension {
    public readonly name = "SysExtension";

    public getTasks(): Record<string, NativeFunc> {
        const valToString = (v: Value): string => {
            switch (v.type) {
                case ValueType.String: return v.value;
                case ValueType.Number: return v.value.toString();
                default: return 'Void';
            }
        };

        return {
            // host
            host_cwd: () => ({ type: ValueType.String, value: process.cwd() }),
            host_isRoot: () => ((process as any).getuid && (process as any).getuid() === 0) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void },
            host_pid: () => ({ type: ValueType.Number, value: process.pid }),

            // os
            os_type: () => {
                const p = process.platform;
                if (p === 'win32') return { type: ValueType.String, value: 'windows' };
                if (p === 'linux') return { type: ValueType.String, value: 'linux' };
                if (p === 'darwin') return { type: ValueType.String, value: 'darwin' };
                return { type: ValueType.String, value: 'unknown' };
            },
            os_name: () => ({ type: ValueType.String, value: process.platform }),
            os_arch: () => ({ type: ValueType.String, value: process.arch }),
            os_memory: () => {
                const mem = process.memoryUsage();
                const map = new Map<string, Value>();
                map.set('total', { type: ValueType.Number, value: mem.heapTotal });
                map.set('free', { type: ValueType.Number, value: mem.heapTotal - mem.heapUsed });
                map.set('used', { type: ValueType.Number, value: mem.heapUsed });
                return { type: ValueType.Map, value: map };
            },
            os_cpu: () => ({ type: ValueType.Number, value: 0 }),

            // fs
            fs_exists: (args) => {
                try {
                    const fs = (global as any).require ? (global as any).require('fs') : null;
                    if (!fs) return { type: ValueType.Void };
                    return fs.existsSync(valToString(args[0])) ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void };
                } catch (e) { return { type: ValueType.Void }; }
            },
            fs_read: (args) => {
                try {
                    const fs = (global as any).require ? (global as any).require('fs') : null;
                    if (!fs) return { type: ValueType.Void };
                    return { type: ValueType.String, value: fs.readFileSync(valToString(args[0]), 'utf8') };
                } catch (e) { return { type: ValueType.Void }; }
            },
            fs_write: (args) => {
                try {
                    const fs = (global as any).require ? (global as any).require('fs') : null;
                    if (!fs) return { type: ValueType.Void };
                    fs.writeFileSync(valToString(args[0]), valToString(args[1]));
                    return { type: ValueType.Number, value: 1 };
                } catch (e) { return { type: ValueType.Void }; }
            },
            fs_deleteFile: (args) => {
                try {
                    const fs = (global as any).require ? (global as any).require('fs') : null;
                    if (!fs) return { type: ValueType.Void };
                    fs.unlinkSync(valToString(args[0]));
                    return { type: ValueType.Number, value: 1 };
                } catch (e) { return { type: ValueType.Void }; }
            },
            fs_stat: (args) => {
                try {
                    const fs = (global as any).require ? (global as any).require('fs') : null;
                    if (!fs) return { type: ValueType.Void };
                    const s = fs.statSync(valToString(args[0]));
                    const map = new Map<string, Value>();
                    map.set('size', { type: ValueType.Number, value: s.size });
                    map.set('mtime', { type: ValueType.Number, value: s.mtime.getTime() });
                    map.set('isDir', s.isDirectory() ? { type: ValueType.Number, value: 1 } : { type: ValueType.Void });
                    return { type: ValueType.Map, value: map };
                } catch (e) { return { type: ValueType.Void }; }
            },

            // proc
            proc_run: (args) => {
                try {
                    const cp = (global as any).require ? (global as any).require('child_process') : null;
                    if (!cp) return { type: ValueType.Void };
                    const cmd = valToString(args[0]);
                    let cmdArgs: string[] = [];
                    if (args.length > 1 && args[1].type === ValueType.Array) {
                        cmdArgs = (args[1] as any).value.map((a: any) => valToString(a));
                    }
                    const res = cp.spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
                    const map = new Map<string, Value>();
                    map.set('code', { type: ValueType.Number, value: res.status });
                    map.set('stdout', { type: ValueType.String, value: res.stdout });
                    map.set('stderr', { type: ValueType.String, value: res.stderr });
                    return { type: ValueType.Map, value: map };
                } catch (e) { return { type: ValueType.Void }; }
            }
        };
    }
}
