import 'server-only';
import {notFound} from 'next/navigation';
import {readSharedBackendRuntime} from './runtime';
export {SHARED_BACKEND_SOURCE as ALIGNED_BACKEND_SOURCE} from './runtime-policy';
// Both fronts select the same server source. Beta UI admission is independent.
// Unknown configuration fails closed; the default existing service is retained.
export async function isAlignedBackendSourceSelected(){
 const runtime=await readSharedBackendRuntime();
 if(runtime.binding==='blocked')notFound();
 return runtime.binding==='aligned';
}
export async function requireAlignedBackendSource(){
 if(!(await isAlignedBackendSourceSelected()))notFound();
}
