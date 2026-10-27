import fs from 'node:fs';
import path from 'node:path';
import {neon} from '@neondatabase/serverless';
import {parse} from 'dotenv';
import {MASTER_SOURCES,parseKisInstrumentMaster,validateMasterBatch} from './lib/kis-instrument-master.mjs';
import {catalogRefreshStatements} from './lib/instrument-catalog-refresh.mjs';

async function main(){
 const args=process.argv.slice(2),dir=args[0];if(!dir)throw Error('reference directory required');
 const apply=args.includes('--apply'),envIndex=args.indexOf('--env-file'),outputIndex=args.indexOf('--output');
 const output=outputIndex>=0?args[outputIndex+1]:null;
 const parts=Object.entries(MASTER_SOURCES).map(([exchange,spec])=>parseKisInstrumentMaster(fs.readFileSync(path.join(dir,spec.file)),exchange));
 const rows=validateMasterBatch(parts),verifiedAt=new Date().toISOString();
 const summary={verifiedAt,apply,rows:rows.length,groups:parts.map(p=>({sourceUrl:p.sourceUrl,sha256:p.sourceSha256,rows:p.rows.length,excluded:p.excluded})),examples:rows.filter(r=>['110990','189300','069500'].includes(r.ticker)),scope:'Domestic ST/EF reference metadata only; no quotes, holdings, targets or transactions'};
 if(!apply){console.log(JSON.stringify(summary,null,2));if(output)fs.writeFileSync(output,JSON.stringify(summary,null,2));return;}
 const url=envIndex>=0?parse(fs.readFileSync(args[envIndex+1])).DATABASE_URL:process.env.DATABASE_URL;
 if(!url)throw Error('DATABASE_URL unavailable');
 const db=neon(url,{fetchOptions:{signal:AbortSignal.timeout(60000)}});
 const [before]=await db.transaction([db.query("select to_regclass('public.instrument_catalog')::text as catalog")],{readOnly:true});
 // Preserve only this public table's before-image. Never read tenant tables.
 let previous=[];if(before[0].catalog)[previous]=await db.transaction([db.query('select * from instrument_catalog order by isin')],{readOnly:true});
 if(output)fs.writeFileSync(output+'.before.json',JSON.stringify({tableExisted:!!before[0].catalog,rows:previous},null,2));
 const ddl=fs.readFileSync(new URL('./sql/instrument-catalog.sql',import.meta.url),'utf8').split(/;\r?\n(?=CREATE|REVOKE|DO)/).filter(s=>s.trim());
 const operations=[{sql:"SET LOCAL statement_timeout = '30s'",params:[]},...ddl.map(sql=>({sql,params:[]})),...catalogRefreshStatements(rows,verifiedAt)];
 const results=await db.transaction(operations.map(q=>db.query(q.sql,q.params)),{isolationLevel:'Serializable'});
 const report={...summary,committed:true,beforeRows:previous.length,result:results.at(-1)};
 if(output)fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(JSON.stringify({error:'instrument catalog refresh failed',code:e.code??e.name,message:typeof e.code==='string'?'Database rejected catalog transaction':e.message?.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]')}));process.exitCode=1;});
