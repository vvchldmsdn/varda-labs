import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),ts=createRequire(path.join(root,'package.json'))('typescript');
// Interactive chart marks/card triggers/dialog close controls keep their own
// geometry and keyboard contracts. These exceptions are not native form fields.
const specializedButtons=new Set([
 'src/components/cairn-v2/beta-details.tsx','src/components/cairn-v2/beta-dialog.tsx',
 'src/components/cairn-v2/holding-heatmap.tsx','src/components/cairn-v2/home-card.tsx',
 'src/components/cairn-v2/today-detail.tsx','src/components/cairn-v2/value-detail.tsx',
]);
const all=[],violations=[],exceptions=[],coverage=[];
function walk(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(!['cairn-ui','__qa'].includes(e.name)&&!p.endsWith(path.join('cairn-v2','ui')))walk(p);}else if(p.endsWith('.tsx')&&!e.name.startsWith('__qa'))all.push(p);}}
walk(path.join(root,'src/components'));walk(path.join(root,'src/app'));
for(const file of all){const relative=path.relative(root,file).replaceAll(path.sep,'/'),source=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let shared=0,hidden=0;const imports=new Set();for(const s of sf.statements)if(ts.isImportDeclaration(s)&&s.moduleSpecifier.text==='@/components/cairn-ui'&&s.importClause?.namedBindings&&ts.isNamedImports(s.importClause.namedBindings))for(const e of s.importClause.namedBindings.elements)imports.add(e.name.text);
 const visit=n=>{if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){const tag=n.tagName.getText(sf);if(imports.has(tag))shared++;if(['form','input','select','textarea','label','fieldset','button'].includes(tag)){
  const type=n.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.text==='type')?.initializer;
  if(tag==='input'&&type&&ts.isStringLiteral(type)&&type.text==='hidden')hidden++;
  else {const item={file:relative,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,tag};if(tag==='button'&&specializedButtons.has(relative))exceptions.push({...item,reason:'specialized chart/card/dialog interaction, no form submit semantics'});else violations.push(item);}
 }}ts.forEachChild(n,visit)};visit(sf);if(shared||hidden)coverage.push({file:relative,sharedInstances:shared,nativeHiddenInputs:hidden});
}
const report={scannedFiles:all.length,consumerFiles:coverage.length,sharedInstances:coverage.reduce((n,r)=>n+r.sharedInstances,0),nativeHiddenInputs:coverage.reduce((n,r)=>n+r.nativeHiddenInputs,0),violations,exceptions,coverage};
if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));else console.log('Cairn UI consumers: '+report.consumerFiles+' files, '+report.sharedInstances+' shared instances, '+report.nativeHiddenInputs+' native hidden inputs, '+exceptions.length+' specialized controls, '+violations.length+' unmigrated form controls');
if(violations.length){if(!process.argv.includes('--json'))console.error(JSON.stringify(violations,null,2));process.exitCode=1;}
