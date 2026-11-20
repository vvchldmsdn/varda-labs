import { getBetaSimulationRead } from '@/lib/cairn-v2/server-simulation';
import { requireBetaFixtureAccess } from '@/lib/cairn-v2/server-access';
import { SIMULATION_BINDING_HEADER } from '@/lib/cairn-v2/home-simulation-read';
import { canonicalBetaReadEpoch } from '@/lib/cairn-v2/read-freshness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function reply(body: object, status: number, binding?: string) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Robots-Tag': 'noindex, nofollow' });
  if (binding) headers.set(SIMULATION_BINDING_HEADER, binding);
  return Response.json(body, { status, headers });
}

export async function GET(request: Request) {
  await requireBetaFixtureAccess();
  const query = new URL(request.url).searchParams;
  const binding = request.headers.get(SIMULATION_BINDING_HEADER);
  const epoch = query.get('_betaRead');
  const keys = ['mode', 'scope', 'currency', 'horizon', 'end', 'run', '_betaRead'];
  if (!binding || !/^[a-f0-9]{64}$/.test(binding) || query.get('mode') !== 'domain' || query.get('run') !== '1' ||
    [...query.keys()].some(key => !keys.includes(key) || query.getAll(key).length !== 1) ||
    epoch !== null && !canonicalBetaReadEpoch(epoch)) return reply({ error: 'invalid_request' }, 400);
  try {
    // Existing service resolves the session and owned scope again, and checks
    // the display binding before starting the expensive evidence read.
    const read = await getBetaSimulationRead(Object.fromEntries(query), binding);
    if (read.state === 'unauthorized') return reply({ error: 'session_unavailable' }, 403);
    if (read.displayBinding && read.displayBinding !== binding) return reply({ error: 'session_changed' }, 409);
    if (!read.displayBinding) return reply({ error: 'session_unavailable' }, 503);
    return reply(read, read.state === 'invalid' ? 400 : 200, binding);
  } catch { return reply({ error: 'simulation_unavailable' }, 503); }
}
