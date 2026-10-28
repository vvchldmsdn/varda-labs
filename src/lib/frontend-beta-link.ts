/** Only public display context crosses frontend zones; authority remains on the server. */
export function buildBetaFrontendHref(params: Pick<URLSearchParams, 'getAll'>, selectedScopeKey?: string): string {
  const query = new URLSearchParams({ mode: 'domain' });
  const scopes = selectedScopeKey ? [selectedScopeKey] : params.getAll('scope');
  for (const scope of scopes.length ? scopes : ['all']) query.append('scope', scope);
  const currencies = params.getAll('currency');
  for (const currency of currencies.length ? currencies : ['KRW']) query.append('currency', currency);
  return '/beta?' + query.toString();
}
