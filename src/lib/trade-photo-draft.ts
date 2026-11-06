import type { ReviewedPhotoTrade } from './trade-photo-import';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const photoDraftKey = (owner: string) => /^[a-f0-9]{64}$/.test(owner) ? `cairn:trade-photo:v1:${owner}` : null;
const fields = ['key', 'operationId', 'accountId', 'assetId', 'afterEventId', 'label', 'side', 'date', 'quantity', 'price', 'currency', 'gross', 'priceSource', 'verified', 'status'] as const;
function clean(row: ReviewedPhotoTrade): ReviewedPhotoTrade {
  return Object.fromEntries(fields.map(key => [key, row[key]])) as ReviewedPhotoTrade;
}
export function readPhotoDraft(store: Store | null, owner: string, now = Date.now()): { rows: ReviewedPhotoTrade[]; active: string } | null {
  const key = photoDraftKey(owner); if (!key || !store) return null;
  try {
    const raw = store.getItem(key); if (!raw) return null;
    const d = raw.length <= 100_000 ? JSON.parse(raw) : null;
    const validRow = (r: ReviewedPhotoTrade) => r && fields.every(k => k === 'verified' ? typeof r[k] === 'boolean' : typeof r[k] === 'string' && r[k].length <= 200)
      && /^[0-9a-f-]{36}$/i.test(r.operationId) && ['buy', 'sell'].includes(r.side) && ['USD', 'KRW', ''].includes(r.currency)
      && ['review', 'saved', 'excluded'].includes(r.status) && ['reported', 'derived', 'missing'].includes(r.priceSource);
    if (d?.version !== 1 || !Number.isFinite(d.at) || now < d.at || now - d.at >= 86400000
      || !Array.isArray(d.rows) || d.rows.length > 50 || !d.rows.every(validRow)
      || new Set(d.rows.map((r: ReviewedPhotoTrade) => r.key)).size !== d.rows.length
      || new Set(d.rows.map((r: ReviewedPhotoTrade) => r.operationId)).size !== d.rows.length) { store.removeItem(key); return null; }
    return { rows: d.rows.map(clean), active: d.rows.some((r: ReviewedPhotoTrade) => r.key === d.active) ? d.active : d.rows[0]?.key ?? '' };
  } catch { return null; }
}
/** Persist only review fields, never image bytes, object URLs or raw OCR text. */
export function savePhotoDraft(store: Store | null, owner: string, rows: ReviewedPhotoTrade[], active: string, now = Date.now()) {
  const key = photoDraftKey(owner); if (!store || !key) return false;
  try {
    if (!rows.length) { store.removeItem(key); return true; }
    const value = JSON.stringify({ version: 1, at: now, rows: rows.map(clean), active });
    if (!readPhotoDraft({ getItem: () => value, removeItem: () => {}, setItem: () => {} }, owner, now)) return false;
    store.setItem(key, value); return true;
  } catch { return false; }
}
