export const SALE_EXCLUSION_LIMIT = 32;
export type SaleExclusionParse = { ok: true; keys: string[] } | { ok: false; keys: []; reason: 'invalid_sale_exclusions' };
/** Request-only constraint. It neither changes holdings/targets nor supplies ownership authority. */
export function parseSaleExclusionKeys(raw: unknown): SaleExclusionParse {
  if (raw === undefined) return { ok: true, keys: [] };
  const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : null;
  if (!values || values.length > SALE_EXCLUSION_LIMIT || values.some(key => typeof key !== 'string' || !/^[a-zA-Z0-9_.:@/-]{1,160}$/.test(key)) || new Set(values).size !== values.length) return { ok: false, keys: [], reason: 'invalid_sale_exclusions' };
  return { ok: true, keys: [...values].sort() };
}
