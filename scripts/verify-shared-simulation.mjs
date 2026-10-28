import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(app,'src/lib/shared-domain');
const manifest=JSON.parse(fs.readFileSync(path.join(output,'_manifest.json'),'utf8'));
const canonical=path.join(app,'packages/cairn-research-domain');
const sourceExists=fs.existsSync(path.join(canonical,'manifest.json'));
if(sourceExists&&JSON.stringify(JSON.parse(fs.readFileSync(path.join(canonical,'manifest.json'),'utf8')))!==JSON.stringify(manifest))throw Error('Research source/output manifests differ. Run guarded sync.');
for(const [relative,expected]of Object.entries(manifest.files))for(const dir of sourceExists?[output,path.join(canonical,'src')]:[output]){
 const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,relative))).digest('hex');
 if(actual!==expected)throw Error('Research domain drift: '+path.relative(app,path.join(dir,relative)));
}
console.log('Shared research domain verified ('+Object.keys(manifest.files).length+' files)');
