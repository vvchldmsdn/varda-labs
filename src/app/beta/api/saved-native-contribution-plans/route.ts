import {publicBetaRequest} from '@/cairn-release/public-request';
import {requireBetaFixtureAccess} from '@/lib/cairn-v2/server-access';
import * as existing from '@/cairn-release/api/saved-native-contribution-plans';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){await requireBetaFixtureAccess();const response=await existing.GET(publicBetaRequest(request));response.headers.set('X-Cairn-Public-Origin-Match',new URL(publicBetaRequest(request).url).origin==='https://varda-labs.vercel.app'?'1':'0');return response}
export async function DELETE(request:Request){await requireBetaFixtureAccess();return existing.DELETE(publicBetaRequest(request))}
