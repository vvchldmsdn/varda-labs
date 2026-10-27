// Uses the existing new-cluster/loopback-only isolation runner. No existing DB URL accepted.
import { rehearseSharedExecution } from './krw-usd-rc-rehearsal.mjs';
try { const result=await rehearseSharedExecution(process.argv.slice(2)); console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='PASS'?0:result.status==='BLOCKED'?2:1; }
catch { console.error('Shared execution rehearsal failed before completion');process.exitCode=1; }
