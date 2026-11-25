import { fxFactor, type FxEvidence } from "../currency-valuation.ts";
import { Decimal } from "../money.ts";

export const CURRENT_VALUATION_FX_MAX_AGE_MS = 3 * 86_400_000;

type ProviderRow = {
  usdKrw: string;
  observedAt: Date | null;
  fetchedAt: Date | null;
  source: string | null;
  rateKind: string | null;
  isSample: boolean;
  status: string | null;
};

type CurrentFx = FxEvidence & { kind: "spot" | "daily_reference" };

/** Current holdings and live performance share a dated valuation quote. A
 * collection timestamp records when the app learned a rate, not its market time. */
export function selectCurrentValuationFx(rows: readonly ProviderRow[], asOf: Date) {
  if (!Number.isFinite(asOf.getTime())) return null;
  const candidates = rows.flatMap((row): CurrentFx[] => {
    const { observedAt, fetchedAt, rateKind } = row;
    if (row.isSample || row.status?.trim().toLowerCase() !== "ok" || !row.source?.trim() ||
        (rateKind !== "spot" && rateKind !== "daily_reference") ||
        !observedAt || !Number.isFinite(observedAt.getTime()) || !fetchedAt || !Number.isFinite(fetchedAt.getTime()) ||
        observedAt > fetchedAt || fetchedAt > asOf) return [];
    try {
      if (Decimal.from(row.usdKrw).compare(0) <= 0) return [];
    } catch { return []; }
    return [{ base: "USD", quote: "KRW", kind: rateKind,
      observedAt: observedAt.toISOString(), fetchedAt: fetchedAt.toISOString(), source: row.source, rate: row.usdKrw }];
  });
  const factor = fxFactor("USD", "KRW", asOf.toISOString(), candidates, CURRENT_VALUATION_FX_MAX_AGE_MS);
  if (!factor.ok) return null;
  // fxFactor validates the freshest observation, including conflicts between
  // providers quoting different values at that instant.
  return candidates.sort((a, b) => b.observedAt.localeCompare(a.observedAt) ||
    b.fetchedAt.localeCompare(a.fetchedAt) || a.source.localeCompare(b.source))[0];
}
