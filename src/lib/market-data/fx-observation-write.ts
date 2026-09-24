import type { FxRateCandidate } from "./fx-refresh.ts";
/** Publication of a provider daily reference, never relabeled as an exchange tick.
 * Missing timestamps must clear old metadata on an overwritten quote. */
export function fxObservationWrite(candidate: FxRateCandidate) {
  const at = candidate.providerTimestamp ? new Date(candidate.providerTimestamp) : null;
  const fetched = Date.parse(candidate.fetchedAt);
  if (candidate.provider !== "er-api-open" || !at || !Number.isFinite(at.getTime()) || !Number.isFinite(fetched) || at.getTime() > fetched || fetched > Date.now()) return { observedAt: null, rateKind: null };
  return { observedAt: at, rateKind: "daily_reference" as const };
}
