import { Decimal } from "../money.ts";
import { buildCycleForSnapshotDate } from "./market-calendar.ts";
import type { NativeStoredAccount, NativeStoredEntry } from "../../db/queries/native-portfolio-ledger.ts";
import type { TrackedNativePosition, TrackedPortfolioEvidence } from "../currency-tracked-portfolio.ts";
import type { NativeSnapshotEvidence } from "../native-portfolio-projection.ts";

/** A boundary is the state BEFORE 07:00. Events exactly at 07:00 belong to the
 * next service day. Neither a delayed worker nor today's quantities can move it. */
export function buildNativeCutoffEvidence(base: TrackedPortfolioEvidence, ledger: {
  accounts: NativeStoredAccount[]; entries: NativeStoredEntry[]; snapshots: { accountId: string; evidence: unknown }[];
  accountsComplete?: boolean; entriesComplete?: boolean;
}, snapshotDate: string, capturedAt: string): TrackedPortfolioEvidence | null {
  const cutoff = buildCycleForSnapshotDate(snapshotDate, new Date(capturedAt)).cycleEndAt.toISOString();
  if (!Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) < Date.parse(cutoff) || ledger.accountsComplete === false || ledger.entriesComplete === false || !ledger.accounts.length) return null;
  const positions: TrackedNativePosition[] = [], sequences: Record<string, number> = {};
  const frames = ledger.snapshots.flatMap(row => {
    const saved = row.evidence as NativeSnapshotEvidence;
    return saved?.version === 1 && saved.frame && Date.parse(saved.frame.at) <= Date.parse(cutoff) ? [saved.frame] : [];
  });
  for (const account of ledger.accounts) {
    const events = ledger.entries.filter(row => row.accountId === account.id).sort((a, b) => a.data.state.sequence - b.data.state.sequence);
    const selected = events.filter(row => Date.parse(row.data.event.at) < Date.parse(cutoff)).at(-1);
    // An opening first observed after the cutoff cannot establish past ownership.
    if (!selected || !account.state || selected.data.state.accountId !== account.id) return null;
    const state = selected.data.state;
    sequences[account.id] = state.sequence;
    for (const holding of state.positions) {
      if (Decimal.from(holding.quantity).compare(0) === 0) continue;
      const asset = account.assets.find(row => row.id === holding.assetId && row.currency === holding.currency);
      if (!asset) return null;
      const candidates = [base.current, ...frames].flatMap(frame => frame.positions.filter(row => row.id === asset.id && row.ownerId === base.ownerId && row.accountId === account.id));
      const rejected = base.current.positions.find(row => row.id === asset.id && row.accountId === account.id)?.evidenceReason;
      const quoted = candidates.filter(row => !rejected && row.observation && !row.unsupportedReason && !row.evidenceReason && row.observation.currency === holding.currency
        && Date.parse(row.observation.priceObservedAt ?? row.observation.at) <= Date.parse(cutoff)
        && Date.parse(row.observation.priceFetchedAt ?? row.observation.at) <= Date.parse(cutoff))
        .sort((a,b) => Date.parse(b.observation!.priceObservedAt ?? b.observation!.at) - Date.parse(a.observation!.priceObservedAt ?? a.observation!.at))
        .find(row => !events.some(event => event.data.event.type === "split" && event.data.event.assetId === asset.id
          && Date.parse(event.data.event.at) < Date.parse(cutoff) && Date.parse(event.data.event.at) > Date.parse(row.observation!.priceObservedAt ?? row.observation!.at)));
      positions.push({ id: asset.id, ownerId: base.ownerId, accountId: account.id, kind: "holding", name: asset.name, ticker: asset.ticker, market: asset.market, costLots: holding.costLots,
        ...(rejected ? { evidenceReason: rejected } : {}), observation: quoted?.observation ? { ...quoted.observation, quantity: holding.quantity, at: cutoff } : null });
    }
    for (const currency of ["KRW", "USD"] as const) positions.push({ id: `cash:${account.id}:${currency}`, ownerId: base.ownerId, accountId: account.id, kind: "cash", name: `${account.name} · ${currency}`, cost: null,
      observation: { quantity: state.cash[currency], price: "1", currency, at: cutoff, priceObservedAt: cutoff, priceFetchedAt: cutoff, basis: "raw", source: "native_ledger_cash" } });
  }
  return { ...base, asOf: capturedAt, current: { at: cutoff, boundary: "before", source: "native_ledger_cutoff_v2", scopeComplete: true, positions },
    history: [], trades: null, cashFlows: undefined, realizedTrades: undefined, realizedTradesComplete: false,
    fx: base.fx.filter(rate => Date.parse(rate.observedAt) <= Date.parse(cutoff) && Date.parse(rate.fetchedAt) <= Date.parse(cutoff)),
    ledgerComplete: true, nativeSequences: sequences };
}
