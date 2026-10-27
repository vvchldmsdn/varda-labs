import type { ClosePrice } from "./providers/types";
import { isFinalizedKisPriceEvidence } from "../shared-domain/market-data/kis-history-finalization";

/** Operational guard, matching the existing KIS cache's 3% discrepancy limit.
 * This is not a return assumption: larger revisions require source investigation. */
export const KIS_HISTORY_REVISION_POLICY = Object.freeze({
  version: "kis_confirmed_history_revision_v2",
  maximumRelativeRawChange: 0.03,
  evidence: "two_independent_matching_raw_and_adjusted_responses",
} as const);

export const kisHistoryIdentity = (row: Pick<ClosePrice, "market" | "currency" | "ticker" | "priceDate">) =>
  [row.market, row.currency, row.ticker, row.priceDate].join(":");

export function isFinalizedKisHistoryDate(row: Pick<ClosePrice, "market" | "currency" | "priceDate" | "fetchedAt">) {
  return isFinalizedKisPriceEvidence(row,row.fetchedAt);
}

/** Internal evidence only; callers never accept confirmation flags from a form. */
export function confirmedKisHistoryRevisions(rows: readonly ClosePrice[], firstObservation: readonly ClosePrice[]) {
  const first = new Map(firstObservation.map(row => [kisHistoryIdentity(row), row]));
  return rows.flatMap(row => {
    const earlier = first.get(kisHistoryIdentity(row));
    if (!earlier || earlier.status !== "ok" || earlier.isSample ||
      !Number.isFinite(Number(earlier.closePrice)) || !Number.isFinite(Number(earlier.adjustedClosePrice)) ||
      !(earlier.fetchedAt instanceof Date) || !(earlier.adjustedCloseFetchedAt instanceof Date) ||
      !Number.isFinite(earlier.adjustedCloseFetchedAt.getTime()) ||
      earlier.adjustedCloseFetchedAt.getTime() > row.adjustedCloseFetchedAt!.getTime() ||
      earlier.fetchedAt.getTime() >= row.fetchedAt.getTime() ||
      !isFinalizedKisHistoryDate(earlier) || !isFinalizedKisHistoryDate(row) ||
      earlier.source !== row.source || earlier.providerSymbol !== row.providerSymbol ||
      earlier.providerExchange !== row.providerExchange ||
      earlier.adjustedCloseBasis !== row.adjustedCloseBasis || earlier.adjustedCloseProvider !== row.adjustedCloseProvider ||
      earlier.adjustedCloseSource !== row.adjustedCloseSource ||
      Number(earlier.closePrice) !== Number(row.closePrice) ||
      Number(earlier.adjustedClosePrice) !== Number(row.adjustedClosePrice)) return [];
    return [{ ...row, firstObservation: earlier }];
  });
}

