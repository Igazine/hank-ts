import { Resource } from '../../../src/Types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
export class FileResource extends Resource {
    static create(filePath) {
        return new FileResource(filePath);
    }
    constructor(filePath) {
        super(filePath);
    }
    load() {
        this.content = fs.readFileSync(this.id, 'utf-8');
    }
    resolve(id) {
        let filePath = id;
        if (!path.isAbsolute(filePath)) {
            const baseDir = path.dirname(this.id);
            filePath = path.resolve(baseDir, id);
        }
        if (!path.extname(filePath)) {
            if (fs.existsSync(filePath + '.hank')) {
                filePath += '.hank';
            }
        }
        return FileResource.create(path.normalize(filePath));
    }
}
