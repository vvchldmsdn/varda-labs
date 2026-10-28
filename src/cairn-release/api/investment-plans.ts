import {requireAlignedBackendSource} from '@/lib/shared-backend/selection';
import * as preserved from '@/app/api/investment-plans/route';
import {savedPlanSession} from '@/lib/shared-backend/saved-plan-session';
export const runtime='nodejs';export const dynamic='force-dynamic';
const response=(body:object,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
export async function GET(request:Request){await requireAlignedBackendSource();if(new URL(request.url).search)return preserved.GET(request);try{const session=await savedPlanSession();if(!session.ok)return response({error:session.error},session.status);const result=await preserved.GET(request);if(!result.ok)return result;return response({...await result.json(),sessionKey:session.key})}catch{return response({error:'service_unavailable'},503)}}
async function mutation(request:Request,method:'POST'|'DELETE'){await requireAlignedBackendSource();try{const session=await savedPlanSession();if(!session.ok)return response({error:session.error},session.status);if(request.headers.get('x-cairn-plan-session')!==session.key)return response({error:'account_changed'},409);return preserved[method](request)}catch{return response({error:'service_unavailable'},503)}}
export async function POST(request:Request){return mutation(request,'POST')}
export async function DELETE(request:Request){return mutation(request,'DELETE')}
