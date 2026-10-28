// Receipts and epochs are freshness markers, never users, sessions, or authorization credentials.
export function createBetaReadFreshness() {
  const seen = new Set<string>();
  let barred: Set<string> | null = null;
  let expectedEpoch: string | null = null;
  return {
    observe(receipt?: string) { if (receipt) seen.add(receipt); },
    begin(epoch: string) { barred = new Set(seen); expectedEpoch = epoch; },
    // Kept as pendingEpoch for href callers: the active generation persists after the pending read settles.
    // Every later domain navigation carries it, so a late response from an older generation stays hidden.
    pendingEpoch() { return expectedEpoch; },
    leaveDomain() { barred = null; expectedEpoch = null; },
    blocked(receipt?: string, epoch?: string) { return expectedEpoch !== null && (!receipt || epoch !== expectedEpoch || barred?.has(receipt) === true); },
    accept(receipt?: string, epoch?: string) {
      if (!receipt) return false;
      seen.add(receipt);
      if (barred !== null && !barred.has(receipt) && epoch === expectedEpoch) { barred = null; return true; }
      return false;
    },
  };
}
export function canonicalBetaReadEpoch(raw: string | string[] | undefined) {
  return typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : undefined;
}
