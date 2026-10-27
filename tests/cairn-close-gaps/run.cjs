const path=require('node:path'),fs=require('node:fs'),cp=require('node:child_process'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'output/close-gap-tests');fs.mkdirSync(out,{recursive:true});
(async()=>{for(const name of ['coverage','worker']){
 const outfile=path.join(out,name+'.cjs');
 await esbuild.build({entryPoints:[path.join(__dirname,name+'.test.ts')],outfile,bundle:true,platform:'node',format:'cjs',conditions:['react-server'],tsconfig:path.join(root,'tsconfig.json'),plugins:name==='worker'?[{name:'isolated-provider-and-db',setup(build){
 build.onLoad({filter:/[/\\]db[/\\]client.ts$/},()=>({contents:"export const sqlClient={query:async()=>[...globalThis.gapTest.dates].map(date=>({date}))};",loader:'ts'}));
 build.onLoad({filter:/[/\\]collection-queue.ts$/},()=>({contents:"export const isMarketCollectionClaimCurrent=async()=>globalThis.gapTest.claimed;",loader:'ts'}));
 build.onLoad({filter:/[/\\]kis-history-cache-sync.ts$/},()=>({contents:"export async function runKisHistoryCacheSync({prefetchedResult}){for(const row of prefetchedResult.rows){globalThis.gapTest.dates.add(row.priceDate);globalThis.gapTest.writes.push(row.priceDate);}return {insertedCount:prefetchedResult.rows.length};}",loader:'ts'}));
 }}]:[]});
 const result=cp.spawnSync(process.execPath,[outfile],{stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status??1);
}})().catch(e=>{console.error(e);process.exitCode=1;});
