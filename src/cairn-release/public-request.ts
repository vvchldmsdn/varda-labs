const PUBLIC_ORIGIN = 'https://varda-labs.vercel.app';
const UPSTREAM_ORIGIN = 'https://cairn-beta-zone-20261025.vercel.app';

/** URL transport binding only. The original session, ownership and CSRF checks still run. */
export function publicBetaRequest(request: Request): Request {
  if (process.env.VERCEL_ENV !== 'production') return request;
  const incoming = new URL(request.url);
  const deploymentHost = process.env.VERCEL_URL;
  const deploymentOrigin = deploymentHost && /^[a-z0-9-]+\.vercel\.app$/.test(deploymentHost)
    ? 'https://' + deploymentHost : null;
  if (incoming.origin === PUBLIC_ORIGIN) return request;
  if (incoming.origin !== UPSTREAM_ORIGIN && incoming.origin !== deploymentOrigin) return request;
  if (request.headers.get('x-cairn-public-host') !== 'varda-labs.vercel.app') return request;
  if (!['GET', 'HEAD'].includes(request.method) && (
    request.headers.get('origin') !== PUBLIC_ORIGIN ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )) return request;
  const publicUrl = new URL(incoming.pathname + incoming.search, PUBLIC_ORIGIN);
  return new Request(publicUrl, request);
}
