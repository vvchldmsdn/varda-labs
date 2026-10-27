import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
for(const file of ['verify-shared-simulation.mjs','verify-financial-domain.mjs']){
 const result=spawnSync(process.execPath,[fileURLToPath(new URL(file,import.meta.url))],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
