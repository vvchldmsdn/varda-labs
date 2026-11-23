import { buildTrackedCurrencyPortfolio, type TrackedPortfolioEvidence } from "../currency-tracked-portfolio.ts";
import { fxFactor, selectValuationFxAt } from "../currency-valuation.ts";
import { Decimal, isCurrency } from "../money.ts";
import { toNumber } from "../portfolio-math.ts";
import type { PerformanceObservation } from "./period-performance.ts";
import { isSnapshotInvestmentAssetType } from "../snapshots/investment-eligibility.ts";

type Row = Readonly<Record<string, unknown>>;
export type CurrentMarks = TrackedPortfolioEvidence & { activeAccountIds?: readonly string[]; fixedKrwByAsset?: ReadonlyMap<string, number> };

/** No market price is needed after a full sale. An unknown quantity or a
 * separately recorded fractional holding still needs valuation evidence. */
export function isEmptyInvestment(quantity: unknown, fixedKrw: unknown) {
  return toNumber(quantity) === 0 && (fixedKrw == null || toNumber(fixedKrw) === 0);
}

/** A single server valuation, never an additional daily close. Keep the same
 * account/asset boundary as the confirmed history and check the independent
 * transaction's full roster and sequence before accepting market evidence. */
export function performanceLiveFrame(evidence: CurrentMarks, owner: string, guards: readonly Row[],
  holdings: boolean, date: string, asOf: string) {
  if (evidence.ownerId !== owner || evidence.reporting !== "KRW" || evidence.asOf !== asOf ||
      evidence.current.at !== asOf || !evidence.current.scopeComplete || !guards.length) return null;
  const accountIds = new Set(guards.map(row => String(row.account_id)));
  const markedAccounts = holdings ? evidence.activeAccountIds : Object.keys(evidence.nativeSequences ?? {});
  if (!markedAccounts || markedAccounts.length !== accountIds.size || markedAccounts.some(id => !accountIds.has(id))) return null;
  const assets = new Map(guards.flatMap(row => typeof row.asset_id === "string" && (!holdings ||
    isSnapshotInvestmentAssetType(typeof row.asset_type === "string" ? row.asset_type : null) &&
    !isEmptyInvestment(row.quantity, row.fixed_krw)) ? [[row.asset_id, row] as const] : []));
  if (guards.some(row => (toNumber(row.sequence) !== (evidence.nativeSequences?.[String(row.account_id)] ?? null)) ||
      row.last_event_at != null && !(Date.parse(String(row.last_event_at)) <= Date.parse(asOf)))) return null;

  // This chart needs only the current valuation. Historic performance uses
  // the actual closing rows and effective events from the tenant transaction.
  const fx = selectValuationFxAt(asOf, asOf, evidence.fx, false).filter(rate => Date.parse(rate.fetchedAt) <= Date.parse(asOf));
  const current = buildTrackedCurrencyPortfolio({ ...evidence, fx, history: [], trades: null, realizedTrades: null }).current;
  if (!current?.complete) return null;
  const fxRate = fxFactor("USD", "KRW", asOf, fx, evidence.maxFxAgeMs);
  const portfolioUsdKrw = fxRate.ok ? fxRate.value.toNumber() : null;
  const marks = new Map(current.positions.map(row => [row.id, row.value]));
  const observations = new Map<string, PerformanceObservation>();
  for (const accountId of accountIds) observations.set(accountId, {
    accountId, date, liveAsOf: asOf, source: holdings ? "current_investments" : "current_native_ledger",
    ...(holdings ? {} : { at: asOf }), expectedPositions: 0, positions: [],
  });
  const seen = new Set<string>(), cash = new Set<string>();
  const cycleStart = Date.parse(date + "T07:00:00+09:00");
  for (const row of evidence.current.positions) {
    const obs = row.observation;
    if (!obs || obs.at !== asOf || !isCurrency(obs.currency) || row.ownerId !== owner ||
        obs.priceFetchedAt && !(Date.parse(obs.priceFetchedAt) <= Date.parse(asOf)) ||
        obs.basis !== "raw" || seen.has(row.id)) return null;
    const guard = assets.get(row.id);
    const fixedKrw = holdings ? evidence.fixedKrwByAsset?.get(row.id) ?? 0 : 0;
    const accountId = row.accountId ?? (guard ? String(guard.account_id) : "");
    const observation = observations.get(accountId);
    const amount = toNumber(marks.get(row.id)), quantity = toNumber(obs.quantity);
    if (!observation || amount === null || amount < 0 || quantity === null || quantity < 0) return null;
    if (row.kind === "cash") {
      if (holdings || row.id !== `cash:${accountId}:${obs.currency}` || obs.source !== "native_ledger_cash" || obs.price !== "1") return null;
      cash.add(row.id);
    } else {
      if (!guard || guard.account_id !== accountId || guard.currency !== obs.currency ||
          (guard.fixed_krw == null ? 0 : toNumber(guard.fixed_krw)) !== fixedKrw || fixedKrw < 0 || guard.quantity == null ||
          Decimal.from(String(guard.quantity)).compare(obs.quantity) !== 0) return null;
    }
    seen.add(row.id);
    const manual = obs.timestampBasis === "stored_valuation";
    observation.positions.push({ assetId: row.id, name: row.name, ticker: row.ticker ?? null, market: row.market ?? null,
      currency: obs.currency, quantity, price: toNumber(obs.price), fxRate: obs.currency === "KRW" ? 1 : portfolioUsdKrw,
      fixedKrw, marketValueKrw: amount + fixedKrw,
      carriedMark: manual && (obs.source === "stored_manual_snapshot" || Date.parse(obs.manualRecordedAt ?? "") < cycleStart) });
  }
  if ([...assets.keys()].some(id => !seen.has(id))) return null;
  for (const [id, observation] of observations) {
    if (!holdings && (!evidence.ledgerComplete || !cash.has(`cash:${id}:KRW`) || !cash.has(`cash:${id}:USD`))) return null;
    observation.expectedPositions = observation.positions.length;
  }
  return { observations: [...observations.values()], portfolioUsdKrw, fx };
}
