import { Decimal } from "../money.ts";
import { buildCycleForSnapshotDate } from "./market-calendar.ts";
import type { NativeStoredAccount, NativeStoredEntry } from "../../db/queries/native-portfolio-ledger.ts";
import type { TrackedNativePosition, TrackedPortfolioEvidence } from "../currency-tracked-portfolio.ts";
import type { NativeSnapshotEvidence } from "../native-portfolio-projection.ts";
import { isNativeCutoffObservation, hasConflictingLatestSnapshotPrices } from "./cutoff-valuation.ts";
import { selectSnapshotCutoffFx } from "./cutoff-fx.ts";

/** A boundary is the state BEFORE 07:00. Events exactly at 07:00 belong to the
 * next service day. Neither a delayed worker nor today's quantities can move it. */
export function buildNativeCutoffEvidence(base: TrackedPortfolioEvidence, ledger: {
  accounts: NativeStoredAccount[]; entries: NativeStoredEntry[]; snapshots: { accountId: string; evidence: unknown }[];
  accountsComplete?: boolean; entriesComplete?: boolean;
  observations?: {accountId:string;evidence:unknown}[];
}, snapshotDate: string, capturedAt: string): TrackedPortfolioEvidence | null {
  const cutoff = buildCycleForSnapshotDate(snapshotDate, new Date(capturedAt)).cycleEndAt.toISOString();
  if (!Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) < Date.parse(cutoff) || ledger.accountsComplete === false || ledger.entriesComplete === false || !ledger.accounts.length) return null;
  const positions: TrackedNativePosition[] = [], sequences: Record<string, number> = {};
  const frames = ledger.snapshots.flatMap(row => {
    const saved = row.evidence as NativeSnapshotEvidence;
    // Frozen licensed observations are historical values, not fresh permission
    // to use that provider again. Only current base evidence carries admission.
    return saved?.version === 1 && saved.frame && Date.parse(saved.frame.at) <= Date.parse(cutoff)
      ? [{...saved.frame, positions: saved.frame.positions.filter(p => p.accountId === row.accountId && p.observation?.source.startsWith("kis") && p.observation.basis === "raw")}]
      : [];
  });
  // A correction invalidates the valuation, not its original KIS quote. These
  // private frames are never performance/history inputs. Licensed provider
  // observations must instead pass their current admission/storage path.
  const originalObservations=(ledger.observations??[]).flatMap(row=>{
    const saved=row.evidence as NativeSnapshotEvidence;
    if(saved?.version!==1||!saved.frame||Date.parse(saved.frame.at)>Date.parse(cutoff))return [];
    return [{...saved.frame,positions:saved.frame.positions.filter(p=>p.accountId===row.accountId && p.observation?.source.startsWith("kis") && p.observation.basis==="raw")}];
  });
  const originalFx=(ledger.observations??[]).flatMap(row=>{
    const saved=row.evidence as NativeSnapshotEvidence;
    return saved?.version===1 && saved.frame && Date.parse(saved.frame.at)<=Date.parse(cutoff)
      ? (saved.fx??[]).filter(rate=>reusableSnapshotFxSource(rate.source)) : [];
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
      const candidates = [base.current, ...frames,...originalObservations].flatMap(frame => frame.positions.filter(row => row.id === asset.id && row.ownerId === base.ownerId && row.accountId === account.id && row.ticker===asset.ticker && row.market===asset.market));
      const rejected = base.current.positions.find(row => row.id === asset.id && row.accountId === account.id)?.evidenceReason;
      const eligible = candidates.filter(row => !rejected && row.observation && !row.unsupportedReason && !row.evidenceReason && row.observation.currency === holding.currency
        && isNativeCutoffObservation({instrument:asset,observation:row.observation,snapshotDate,cycleEndAt:new Date(cutoff),capturedAt:new Date(capturedAt)}));
      const conflict = hasConflictingLatestSnapshotPrices(eligible.filter(row => row.observation!.priceKind !== "close")
        .map(row => ({price:row.observation!.price,referenceAt:row.observation!.priceObservedAt ?? row.observation!.priceFetchedAt!})));
      const quoted = eligible.filter(row => !conflict || row.observation!.priceKind === "close")
        .sort((a,b) => Number(a.observation!.priceKind === "close")-Number(b.observation!.priceKind === "close")
          || Date.parse(b.observation!.priceObservedAt ?? b.observation!.at) - Date.parse(a.observation!.priceObservedAt ?? a.observation!.at))
        .find(row => !events.some(event => event.data.event.type === "split" && event.data.event.assetId === asset.id
          && Date.parse(event.data.event.at) < Date.parse(cutoff)
          && (row.observation!.priceKind === "close" && row.observation!.priceReferenceDate
            ? event.data.event.at.slice(0,10) >= row.observation!.priceReferenceDate
            : Date.parse(event.data.event.at) > Date.parse(row.observation!.priceObservedAt ?? row.observation!.at))));
      positions.push({ id: asset.id, ownerId: base.ownerId, accountId: account.id, kind: "holding", name: asset.name, ticker: asset.ticker, market: asset.market, costLots: holding.costLots,
        ...(rejected ? { evidenceReason: rejected } : {}), observation: quoted?.observation ? { ...quoted.observation, quantity: holding.quantity, at: cutoff } : null });
    }
    for (const currency of ["KRW", "USD"] as const) positions.push({ id: `cash:${account.id}:${currency}`, ownerId: base.ownerId, accountId: account.id, kind: "cash", name: `${account.name} · ${currency}`, cost: null,
      observation: { quantity: state.cash[currency], price: "1", currency, at: cutoff, priceObservedAt: cutoff, priceFetchedAt: cutoff, basis: "raw", source: "native_ledger_cash" } });
  }
  const fx = [...base.fx,...originalFx].filter(rate => selectSnapshotCutoffFx([{
    ...rate,usdKrw:rate.rate,rateDate:rate.observedAt.slice(0,10),rateKind:rate.kind,status:"ok",isSample:false,
  }],snapshotDate,new Date(cutoff)) !== null);
  return { ...base, asOf: capturedAt, current: { at: cutoff, boundary: "before", source: "native_ledger_cutoff_v2", scopeComplete: true, positions },
    history: [], trades: null, cashFlows: undefined, realizedTrades: undefined, realizedTradesComplete: false,
    fx,
    ledgerComplete: true, nativeSequences: sequences, nativeRevisions:Object.fromEntries(ledger.accounts.map(a=>[a.id,a.revision??0])) };
}

function reusableSnapshotFxSource(source: string) {
  // Explicitly retain the existing KIS/public-reference sources. An unknown or
  // licensed provider must enter through the current storage/admission reader.
  return source.startsWith("kis") || source === "er-api_open_access" || source === "frankfurter";
}
