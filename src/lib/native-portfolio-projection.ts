import { Decimal } from "./money.ts";
import type { TrackedPortfolioEvidence, TrackedValuationFrame, TrackedNativePosition, TrackedTrade, TrackedRealizedTrade } from "./currency-tracked-portfolio.ts";
import type { FxEvidence } from "./currency-valuation.ts";
import type { NativeStoredAccount, NativeStoredEntry } from "../db/queries/native-portfolio-ledger.ts";
import type { NativeGroupSelection } from "./native-group-scope.ts";

export type NativeSnapshotEvidence = { version: 1; frame: TrackedValuationFrame; fx: readonly FxEvidence[]; sequence: number };
/** Adapts the actual owner ledger into the existing valuation engine, never fabricates a price. */
export function attachNativeLedgerEvidence(base: TrackedPortfolioEvidence, ledger: { accounts: NativeStoredAccount[]; entries: NativeStoredEntry[]; snapshots: { accountId: string; evidence: unknown }[]; accountsComplete?: boolean; historyComplete?: boolean }, scopeKind: string, selection?: NativeGroupSelection): TrackedPortfolioEvidence {
  const historyComplete = ledger.historyComplete !== false;
  if (!historyComplete) ledger = { ...ledger, entries: [], snapshots: [] };
  const group = scopeKind === "portfolio_group";
  const whole = new Set(selection?.wholeAccountIds ?? []), direct = new Set(selection?.directAssetIds ?? []);
  const includesCash = (accountId: string) => !group || whole.has(accountId);
  const includesAsset = (accountId: string, assetId: string) => !group || whole.has(accountId) || direct.has(assetId);
  if (group) ledger = { ...ledger, accounts: ledger.accounts.filter(a => whole.has(a.id) || a.assets.some(asset => direct.has(asset.id))) };
  const allowed = new Set(ledger.accounts.map(row => row.id));
  let complete = ledger.accountsComplete !== false && ledger.accounts.length > 0 && (!group || Boolean(selection));
  let realizedTradesComplete = complete && historyComplete;
  const positions = base.current.positions.map(row => ({ ...row }));
  let flowIssue: string | undefined;
  if (group) {
    const missing = [...whole].filter(id => !allowed.has(id)).map(id => `account:${id}`).concat([...direct].filter(id => !ledger.accounts.some(a => a.assets.some(asset => asset.id === id))));
    for (const id of missing) positions.push({ id, ownerId: base.ownerId, name: "미확인 자산", observation: null });
    if (missing.length) { complete = false; realizedTradesComplete = false; }
  }
  for (const account of ledger.accounts) {
    const state = account.state;
    if (!state || Date.parse(state.at) > Date.parse(base.asOf)) {
      complete = false; realizedTradesComplete = false;
      if (includesCash(account.id)) positions.push({ id: `cash:${account.id}:unknown`, ownerId: base.ownerId, accountId: account.id, kind: "cash", name: `${account.name} · Cash`, observation: null, unsupportedReason: "cash_not_observed" });
      continue;
    }
    if (state.positions.some(p => !account.assets.some(a => a.id === p.assetId && a.currency === p.currency && Decimal.from(a.quantity).compare(p.quantity) === 0 && a.archived === (Decimal.from(p.quantity).compare(0) === 0))) || account.assets.some(a => !a.archived && !state.positions.some(p => p.assetId === a.id && Decimal.from(p.quantity).compare(a.quantity) === 0))) { complete = false; realizedTradesComplete = false; continue; }
    for (const p of state.positions) {
      if (!includesAsset(account.id, p.assetId)) continue;
      const row = positions.find(row => row.id === p.assetId);
      if (row) { row.accountId = account.id; row.kind = "holding"; row.costLots = p.costLots; if (!row.observation || Decimal.from(row.observation.quantity).compare(p.quantity) !== 0) complete = false; }
      else if (Decimal.from(p.quantity).compare(0) !== 0) complete = false;
    }
    if (includesCash(account.id) && account.active !== false) for (const currency of ["KRW", "USD"] as const) {
      positions.push({ id: `cash:${account.id}:${currency}`, ownerId: base.ownerId, accountId: account.id, name: `${account.name} · ${currency}`, kind: "cash", cost: null,
        observation: { quantity: state.cash[currency], price: "1", currency, at: base.asOf, priceObservedAt: base.asOf, basis: "raw", source: "native_ledger_cash" } });
    }
  }
  if (positions.some(row => row.kind !== "cash" && !row.accountId)) complete = false;
  const grouped = new Map<string, { frames: TrackedValuationFrame[]; accounts: Set<string> }>();
  const fx = [...base.fx];
  for (const snapshot of ledger.snapshots) {
    const data = snapshot.evidence as NativeSnapshotEvidence;
    if (!allowed.has(snapshot.accountId) || data?.version !== 1 || !data.frame || Date.parse(data.frame.at) >= Date.parse(base.asOf) || (selection && Date.parse(data.frame.at) < Date.parse(selection.stableSince))) continue;
    if (data.frame.positions.some(row => row.ownerId !== base.ownerId || row.accountId !== snapshot.accountId)) throw new Error("native_snapshot_owner_mismatch");
    const group = grouped.get(data.frame.at) ?? { frames: [], accounts: new Set<string>() };
    if (group.accounts.has(snapshot.accountId)) throw new Error("native_snapshot_duplicate");
    group.frames.push({ ...data.frame, positions: data.frame.positions.filter(row => row.kind === "cash" ? includesCash(snapshot.accountId) : includesAsset(snapshot.accountId, row.id)) }); group.accounts.add(snapshot.accountId); grouped.set(data.frame.at, group);
    fx.push(...data.fx.map(rate => ({ ...rate, capturedAt: data.frame.at })));
  }
  const history: TrackedValuationFrame[] = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([at, group]) => {
    // An explicitly closed, empty account stays part of historical ownership.
    // Its zero value after closure needs no invented quote or earlier quantity.
    const closedEmpty = ledger.accounts.filter(account => !group.accounts.has(account.id) && account.active === false && account.updatedAt && Date.parse(account.updatedAt) <= Date.parse(at) && account.state && Object.values(account.state.cash).every(value => Decimal.from(value).compare(0) === 0) && account.state.positions.every(position => Decimal.from(position.quantity).compare(0) === 0));
    return { at, source: "native_ledger_snapshot", positions: group.frames.flatMap(frame => frame.positions), scopeComplete: group.accounts.size + closedEmpty.length === allowed.size && group.frames.every(frame => frame.scopeComplete) };
  });
  const cashFlows: NonNullable<TrackedPortfolioEvidence["cashFlows"]>[number][] = [];
  const trades: TrackedTrade[] = [];
  const splits: NonNullable<TrackedPortfolioEvidence["splits"]>[number][] = [];
  const realizedTrades: TrackedRealizedTrade[] = [];
  const before = history.at(-1)?.at;
  let corporateActionsInWindow = false;
  for (const entry of ledger.entries) {
    if (!allowed.has(entry.accountId)) continue;
    const event = entry.data.event;
    if (event.type === "opening") continue;
    if (event.type === "sell" && includesAsset(entry.accountId, event.assetId) && (!selection || Date.parse(event.at) >= Date.parse(selection.stableSince))) {
      const realized = (entry.data.effect as (NonNullable<NativeStoredEntry["data"]["effect"]> & { realized?: Pick<TrackedRealizedTrade, "proceeds" | "disposedCostLots"> | null }) | null)?.realized;
      const sold = ledger.accounts.find(account => account.id === entry.accountId)?.assets.find(asset => asset.id === event.assetId);
      realizedTrades.push({ id: entry.id, ownerId: base.ownerId, accountId: entry.accountId, positionId: event.assetId, name: sold?.name ?? event.assetId,
        at: event.at, source: event.source, proceeds: realized?.proceeds ?? null, disposedCostLots: realized?.disposedCostLots ?? null });
    }
    for (const [index, leg] of (entry.data.effect?.cashLegs ?? []).entries()) {
      if (includesCash(entry.accountId)) {
        const externalToScope = event.type === "transfer" && (!allowed.has(event.peerAccountId) || !includesCash(event.peerAccountId));
        cashFlows.push({ ...leg, kind: leg.kind as NonNullable<TrackedPortfolioEvidence["cashFlows"]>[number]["kind"], externalToScope, id: `${entry.id}:${index}`, ownerId: base.ownerId, accountId: entry.accountId, at: event.at });
        if (before && Date.parse(event.at) > Date.parse(before)) trades.push({ id: `${entry.id}:cash:${index}`, ownerId: base.ownerId, positionId: `cash:${entry.accountId}:${leg.currency}`, quantityDelta: leg.delta, price: "1", currency: leg.currency, at: event.at, source: "native_ledger_cash", sequence: entry.data.state.sequence });
      } else if ((event.type === "buy" || event.type === "sell" || event.type === "dividend" || event.type === "fee") && event.assetId && includesAsset(entry.accountId, event.assetId)) {
        // This account's cash is outside the group. Cash paid into a selected
        // holding is capital in; sale proceeds/distributions are capital out.
        cashFlows.push({ ...leg, delta: Decimal.from(leg.delta).mul(-1).toExactString(), kind: "external", id: `${entry.id}:${index}`, ownerId: base.ownerId, accountId: entry.accountId, at: event.at });
      } else if ((event.type === "dividend" || event.type === "fee") && !event.assetId && Date.parse(event.at) > Date.parse(history[0]?.at ?? base.asOf)) flowIssue = "group_income_allocation_missing";
    }
    if (before && Date.parse(event.at) > Date.parse(before) && (event.type === "buy" || event.type === "sell") && includesAsset(entry.accountId, event.assetId)) trades.push({ id: `${entry.id}:asset`, ownerId: base.ownerId, positionId: event.assetId, quantityDelta: Decimal.from(event.quantity).mul(event.type === "buy" ? 1 : -1).toExactString(), price: event.price, currency: event.currency, at: event.at, source: event.source, sequence: entry.data.state.sequence });
    if (before && Date.parse(event.at) > Date.parse(before) && event.type === "split" && includesAsset(entry.accountId, event.assetId)) { corporateActionsInWindow = true; splits.push({ at: event.at, positionId: event.assetId, ratio: event.ratio, sequence: entry.data.state.sequence }); }
  }
  // A new/sold holding has a zero quantity at the other endpoint, not an invented
  // historical holding. A neutral unit factor is used ONLY for explicit zero quantity.
  const current: TrackedValuationFrame = { ...base.current, positions, scopeComplete: complete };
  const baseline = history.at(-1);
  if (baseline) {
    const all = new Map([...baseline.positions, ...positions].map(row => [row.id, row]));
    for (const [id, row] of all) {
      for (const frame of [baseline, current]) if (!frame.positions.some(p => p.id === id)) {
        const leg = trades.find(t => t.positionId === id);
        const closedZero = frame === current && row.kind === "cash" && row.observation && Decimal.from(row.observation.quantity).compare(0) === 0 && ledger.accounts.some(account => account.id === row.accountId && account.active === false && account.state && Decimal.from(account.state.cash[row.observation!.currency]).compare(0) === 0);
        if ((!leg && !closedZero) || !row.observation) { frame.scopeComplete = false; continue; }
        const zero: TrackedNativePosition = { ...row, cost: null, costLots: [], observation: { ...row.observation, quantity: "0", at: frame.at, priceObservedAt: frame.at, price: "1", source: "zero_quantity_boundary" } };
        frame.positions = [...frame.positions, zero];
      }
    }
  }
  return { ...base, current, history, trades: complete && historyComplete && !flowIssue ? trades : null, fx, ledgerComplete: complete && !flowIssue, cashFlows: historyComplete ? cashFlows : undefined, corporateActionsInWindow, splits, realizedTrades: historyComplete ? realizedTrades : null, realizedTradesComplete, ...(selection ? { groupEvidence: { policy: "current_membership_whole_cash_direct_holdings", stableSince: selection.stableSince, reason: flowIssue ?? null } } : {}), nativeSequences: Object.fromEntries(ledger.accounts.filter(a => a.state && a.active !== false).map(a => [a.id, a.state!.sequence])) };
}
