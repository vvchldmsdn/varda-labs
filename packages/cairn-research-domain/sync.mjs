import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const verifyOnly=process.argv.includes('--check');
const requested=process.argv.flatMap((arg,i)=>arg==='--target'?[process.argv[i+1]]:[]);
const targets=requested.length?requested.map(dir=>path.resolve(process.cwd(),dir)):[path.resolve(root,'../../src/lib/shared-domain')];
for(const destination of targets){
 const priorFile=path.join(destination,'_manifest.json');
 const previous=fs.existsSync(priorFile)?JSON.parse(fs.readFileSync(priorFile,'utf8')):null;
 for(const [relative,expected]of Object.entries(manifest.files)){
  const source=path.join(root,'src',relative),target=path.join(destination,relative),content=fs.readFileSync(source);
  if(hash(content)!==expected)throw Error('Canonical manifest needs review: '+relative);
  if(fs.existsSync(target)){
   const current=hash(fs.readFileSync(target));
   if(current!==expected&&current!==previous?.files[relative])throw Error('Refusing independently changed consumer: '+relative);
   if(verifyOnly&&current!==expected)throw Error('Outdated consumer: '+relative);
  }else if(verifyOnly)throw Error('Missing consumer: '+relative);
  if(!verifyOnly){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
 }
 if(!verifyOnly)fs.writeFileSync(priorFile,JSON.stringify(manifest,null,2)+'\n');
}
console.log('Shared historical domain: '+targets.length+' artifact(s) '+(verifyOnly?'verified':'generated'));
