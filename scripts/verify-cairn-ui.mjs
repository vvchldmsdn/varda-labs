import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'packages/cairn-ui/src'),output=path.join(root,'src/components/cairn-ui');
const manifestFile=path.join(root,'packages/cairn-ui/manifest.json');
const sync=process.argv.includes('--sync');
if(process.argv.slice(2).some(arg=>arg!=='--sync'))throw Error('Usage: node scripts/verify-cairn-ui.mjs [--sync]');
const prior=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):null;
const hash=data=>createHash('sha256').update(data).digest('hex');
const files=fs.readdirSync(source).filter(name=>/\.(?:tsx?|css)$/.test(name)).sort();
const entries=files.map(file=>{const bytes=fs.readFileSync(path.join(source,file)),expected=hash(bytes),target=path.join(output,file),actual=fs.existsSync(target)?hash(fs.readFileSync(target)):null;
 if(sync){if(actual!==null&&actual!==expected&&actual!==prior?.files?.[file])throw Error('Refusing independently changed Cairn UI consumer: '+file);}
 else if(prior?.files?.[file]!==expected||actual!==expected)throw Error('Cairn UI source/output drift: '+file);
 return {file,bytes,expected,target};});
if(!sync&&JSON.stringify(Object.keys(prior?.files??{}).sort())!==JSON.stringify(files))throw Error('Cairn UI manifest file list drift');
if(sync){fs.mkdirSync(output,{recursive:true});for(const entry of entries)fs.writeFileSync(entry.target,entry.bytes);fs.writeFileSync(manifestFile,JSON.stringify({version:1,authority:'packages/cairn-ui/src',files:Object.fromEntries(entries.map(e=>[e.file,e.expected]))},null,2)+'\n');}
console.log('Cairn UI verified: '+entries.length+' shared presentation files');
