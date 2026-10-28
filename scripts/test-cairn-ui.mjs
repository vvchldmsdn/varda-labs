import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'package.json')),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const ui=path.join(root,'src/components/cairn-ui'),canonical=path.join(root,'packages/cairn-ui/src');
const originalTsx=Module._extensions['.tsx'],originalCss=Module._extensions['.css'];
Module._extensions['.tsx']=(module,file)=>{
 assert.ok(file.startsWith(ui+path.sep),'test imports only shared presentation modules');
 module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
};
Module._extensions['.css']=(module,file)=>{assert.ok(file.startsWith(ui+path.sep));module.exports={__esModule:true,default:new Proxy({},{get:(_target,key)=>String(key)})};};
try {
 const {Button,Input,Select,Textarea,Checkbox,Radio,Field,Fieldset,Form,FormActions,FormSection,Status,ValidationMessage}=require(path.join(ui,'forms.tsx'));
 const ref={current:null},onChange=()=>{},onClick=()=>{},action=async()=>{};
 const input=Input({name:'quantity',value:'0.010709',required:true,inputMode:'decimal','aria-describedby':'quantity-help',onChange,ref});
 assert.equal(input.type,'input');for(const [key,value]of Object.entries({name:'quantity',value:'0.010709',required:true,inputMode:'decimal','aria-describedby':'quantity-help',onChange,ref}))assert.equal(input.props[key],value);
 assert.equal(Button({children:'implicit submit'}).props.type,undefined,'keep native implicit submit');
 assert.equal(Button({type:'button',name:'intent',value:'preview',onClick,disabled:true}).props.onClick,onClick);
 assert.equal(Button({type:'button'}).props.type,'button');
 assert.equal(Form({action,ref,onSubmit:onClick}).props.action,action);assert.equal(Form({ref}).props.ref,ref);
 assert.equal(Fieldset({disabled:true}).props.disabled,true);
 assert.equal(Checkbox({name:'confirm',required:true,defaultChecked:true}).props.type,'checkbox');
 assert.equal(Radio({name:'currency',value:'USD'}).props.type,'radio');
 assert.equal(Select({name:'currency',multiple:true,defaultValue:['USD'],onChange,ref}).props.multiple,true);
 assert.equal(Textarea({name:'memo',maxLength:200,defaultValue:'note',ref}).props.ref,ref);
 assert.equal(Input({type:'date',min:'2026-01-01',max:'2026-12-31',step:'1'}).props.min,'2026-01-01');
 assert.equal(Input({presentation:'amount'}).props.presentation,undefined,'presentation is not a DOM attribute');
 assert.equal(Input({presentation:'amount'}).props['data-presentation'],'amount');
 const dom=renderToStaticMarkup(React.createElement(Form,{id:'synthetic-form'},
  React.createElement(Field,{htmlFor:'qty',hint:'Six decimal places'},'Executed quantity',React.createElement(Input,{id:'qty',name:'quantity',defaultValue:'0.010709',required:true})),
  React.createElement(Select,{name:'currency',defaultValue:'USD'},React.createElement('option',{value:'KRW'},'KRW'),React.createElement('option',{value:'USD'},'USD')),
  React.createElement(FormSection,{title:'Optional information'},React.createElement(Textarea,{name:'memo',defaultValue:'Synthetic only'})),
  React.createElement(FormActions,null,React.createElement(Button,{type:'submit',name:'intent',value:'record'},'Record'))));
 assert.match(dom,/<label[^>]*for="qty"/);assert.match(dom,/<input(?=[^>]*name="quantity")(?=[^>]*required="")[^>]*>/);assert.match(dom,/<option value="USD" selected="">/);assert.match(dom,/<legend/);assert.match(dom,/<button(?=[^>]*name="intent")(?=[^>]*value="record")[^>]*>/);
 const status=renderToStaticMarkup(React.createElement('p',null,React.createElement(Status,{as:'span','aria-live':'polite'},'Ready')));
 assert.match(status,/^<p><span/);assert.doesNotMatch(status,/<div/);assert.match(status,/role="status"/);
 assert.match(renderToStaticMarkup(React.createElement(ValidationMessage,null,'Invalid')),/role="alert"/);
 // Exercise the actual client hook with deterministic commit/effect callbacks.
 // A resolved action's automatic reset is cancelled unless a successful create
 // explicitly grants the reset, and that grant must never leak to later resets.
 const hookModule=new Module(path.join(ui,'client.ts'));
 let slots=[],cursor=0,effects=[];
 const sameDeps=(a,b)=>a?.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const hooks={useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial})},useCallback(callback,deps){const i=cursor++;if(!slots[i]||!sameDeps(slots[i].deps,deps))slots[i]={deps,value:callback};return slots[i].value},useEffect(effect,deps){const i=cursor++;if(!slots[i]||!sameDeps(slots[i],deps)){slots[i]=deps;effects.push(effect)}}};
 hookModule.require=name=>{assert.equal(name,'react');return hooks;};
 hookModule._compile(ts.transpileModule(fs.readFileSync(path.join(ui,'client.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,path.join(ui,'client.ts'));
 let handlers,draft='failed draft',resets=0;
 const form={reset(){let prevented=false;handlers.onReset({preventDefault(){prevented=true}});if(!prevented){draft='';resets++;}}};
 const runHook=(state,resetOnSuccess=true)=>{cursor=0;handlers=hookModule.exports.useActionFormReset(state,{resetOnSuccess});return handlers;};
 const commit=()=>{for(const effect of effects.splice(0))effect();};
 runHook({status:'idle'});assert.equal(typeof handlers.formRef,'function');assert.equal(handlers.formRef(form),undefined);commit();
 const stableRef=handlers.formRef;runHook({status:'error'});assert.equal(handlers.formRef,stableRef);commit();form.reset();assert.equal(draft,'failed draft');assert.equal(resets,0);
 const savedState={status:'success'};runHook(savedState);assert.equal(draft,'failed draft','render never resets form');commit();assert.equal(draft,'');assert.equal(resets,1);
 draft='next draft';form.reset();assert.equal(draft,'next draft','success permission is scoped to its explicit reset');runHook(savedState);commit();assert.equal(draft,'next draft','unchanged action state cannot reset a later draft');
 runHook({status:'success'});commit();assert.equal(resets,2,'a later successful create can reset again');handlers.formRef(null);runHook({status:'success'});commit();assert.equal(resets,2,'detached forms are not reset');
 slots=[];effects=[];draft='edit draft';runHook({status:'success'},false);handlers.formRef(form);commit();form.reset();assert.equal(draft,'edit draft','successful editing does not clear fields by default');
 for(const name of fs.readdirSync(canonical)){if(!/\.(tsx?|css)$/.test(name))continue;assert.deepEqual(fs.readFileSync(path.join(canonical,name)),fs.readFileSync(path.join(ui,name)),'canonical/generated drift: '+name);}
 const guard=spawnSync(process.execPath,['scripts/verify-cairn-ui.mjs'],{cwd:root,encoding:'utf8'});assert.equal(guard.status,0,guard.stdout+guard.stderr);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cairn-ui-contract-'));
 try {for(const relative of ['packages/cairn-ui','src/components/cairn-ui','scripts'])fs.mkdirSync(path.join(temp,relative),{recursive:true});
  fs.cpSync(path.join(root,'packages/cairn-ui'),path.join(temp,'packages/cairn-ui'),{recursive:true});fs.cpSync(ui,path.join(temp,'src/components/cairn-ui'),{recursive:true});fs.copyFileSync(path.join(root,'scripts/verify-cairn-ui.mjs'),path.join(temp,'scripts/verify-cairn-ui.mjs'));
  const altered=path.join(temp,'src/components/cairn-ui/forms.tsx');fs.appendFileSync(altered,'\n// independent drift\n');const before=fs.readFileSync(altered);
  const reject=spawnSync(process.execPath,['scripts/verify-cairn-ui.mjs'],{cwd:temp,encoding:'utf8'});assert.notEqual(reject.status,0,'build must fail on generated drift');
  const rejectSync=spawnSync(process.execPath,['scripts/verify-cairn-ui.mjs','--sync'],{cwd:temp,encoding:'utf8'});assert.notEqual(rejectSync.status,0,'sync must not overwrite independently edited output');assert.deepEqual(fs.readFileSync(altered),before);
 } finally {const resolved=path.resolve(temp),base=path.resolve(os.tmpdir());assert.equal(path.dirname(resolved),base);assert.ok(path.basename(resolved).startsWith('cairn-ui-contract-'));fs.rmSync(resolved,{recursive:true,force:true});}
 console.log('Cairn UI contract passed: native props, refs, submit, labels, status semantics, SSR, action-reset draft retention, source parity, drift rejection');
} finally {if(originalTsx)Module._extensions['.tsx']=originalTsx;else delete Module._extensions['.tsx'];if(originalCss)Module._extensions['.css']=originalCss;else delete Module._extensions['.css'];}
