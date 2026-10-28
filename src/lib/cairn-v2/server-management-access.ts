import 'server-only';
import {notFound} from 'next/navigation';
import {readSharedBackendRuntime} from '../shared-backend/runtime';
// UI capability is not user authority. Original actions resolve the active
// session and validate the owned mutation target on every request.
export async function betaAccountManagementAvailable(){
 return (await readSharedBackendRuntime()).betaManagement;
}
export async function requireBetaAccountManagementAccess(){
 if(!(await betaAccountManagementAvailable()))notFound();
}
