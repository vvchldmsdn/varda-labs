import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),file=path.join(root,'manifest.json');
const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
const entries=[];function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isDirectory())visit(name);else if(name.endsWith('.ts'))entries.push([path.relative(path.join(root,'src'),name).split(path.sep).join('/'),crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex')]);}}
visit(path.join(root,'src'));manifest.files=Object.fromEntries(entries.sort(([a],[b])=>a.localeCompare(b)));fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');console.log('Updated source hashes. Review the manifest diff, then run guarded sync and tests.');
