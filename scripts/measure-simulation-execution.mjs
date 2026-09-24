// Pure deterministic engine/codec benchmark. No env loading, DB, provider or network.
import { performance } from 'node:perf_hooks';
import { executionFixture } from '../tests/support/shared-execution-fixture.mjs';
import { packExecution, decodePath } from '../src/lib/simulation-execution-codec.ts';
const model=process.argv[2]??'economic', assets=Number(process.argv[3]??3), horizon=Number(process.argv[4]??21);
const snapshot=executionFixture(model,assets,horizon);
const before=performance.now(), packed=packExecution('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',snapshot), packMs=performance.now()-before;
const handle={executionId:packed.id,binding:packed.binding,model,currency:'KRW',preview:false,expiresAt:Date.now()+21600000};
const readStart=performance.now(), selected=packed.chunks.find(p=>p.first<=141&&p.first+p.count>141), detail=decodePath(handle,141,packed.common,selected);
console.log(JSON.stringify({model,assets,horizon,paths:1000,numericRawBytes:[snapshot.growth,snapshot.chart,snapshot.states,snapshot.drawRows,snapshot.blockStarts].reduce((n,b)=>n+b.byteLength,0),minimumRawBytes:packed.rawBytes,compressedBytes:packed.bytes,base64Bytes:packed.common.data.length+packed.chunks.reduce((s,c)=>s+c.data.length,0),chunkRows:packed.chunks.length,packMs,readDecodeMs:performance.now()-readStart,selectedReadBytes:packed.common.bytes+selected.bytes,selectedResponseBytes:Buffer.byteLength(JSON.stringify(detail)),rssPeakBytes:process.resourceUsage().maxRSS*1024,dbTransport:'NOT RUN'},null,2));
