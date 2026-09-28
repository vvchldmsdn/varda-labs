import { rehearseCutoffObservations } from './krw-usd-rc-rehearsal.mjs';
const result=await rehearseCutoffObservations(process.argv.slice(2));
console.log(JSON.stringify(result,null,2));
process.exitCode=result.status==='PASS'?0:1;
