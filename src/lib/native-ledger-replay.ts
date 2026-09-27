import { applyNativeEvent, type NativeEvent, type NativePortfolioState } from "./native-portfolio-ledger";
import type { NativeMutation, NativeStoredAccount, NativeStoredEntry } from "@/db/queries/native-portfolio-ledger";

export type HistoricalTrade = { reason: string; notInOpening: true; replaces?: string; afterEventId?: string };
/** Reuses the financial engine. Sequence is replay order; the final sequence is
 * the durable command revision, so a concurrent normal writer always conflicts. */
export function replayNativeTrade(accounts: NativeStoredAccount[], entries: NativeStoredEntry[], input: NativeMutation) {
  const history = input.history;
  const event = input.event;
  if (!history || !event || !["buy", "sell"].includes(event.type)) throw new Error("historical_trade_required");
  if (!history.notInOpening) throw new Error("opening_already_includes_trade");
  const primary = accounts.find(a => a.id === input.accountId);
  if (!primary?.state || primary.state.sequence !== input.expectedSequence) throw new Error("conflict");
  // Transfers are immutable in this flow. Replay every connected account and
  // compare the two recorded legs, rather than silently recalculating one side.
  const affected = new Set([input.accountId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of entries) if (entry.data.event.type === "transfer" && affected.has(entry.accountId)) {
      if (!affected.has(entry.data.event.peerAccountId)) { affected.add(entry.data.event.peerAccountId); changed = true; }
    }
  }
  if (affected.size > 8) throw new Error("historical_scope_too_large");
  const relevant = entries.filter(e => affected.has(e.accountId));
  if (relevant.length > 500) throw new Error("historical_scope_too_large");
  for (const e of relevant) if (e.data.event.type === "transfer") {
    const transfer = e.data.event;
    const peer = relevant.filter(p => p.accountId === transfer.peerAccountId && p.data.event.type === "transfer" && p.data.event.transferId === transfer.transferId);
    if (peer.length !== 1 || peer[0].data.event.type !== "transfer" || peer[0].data.event.direction === transfer.direction || peer[0].data.event.amount !== transfer.amount || peer[0].data.event.currency !== transfer.currency || peer[0].data.event.at !== transfer.at || peer[0].data.event.peerAccountId !== e.accountId) throw new Error("historical_transfer_evidence_missing");
  }
  const original = history.replaces ? relevant.find(e => e.accountId === input.accountId && e.id === history.replaces) : null;
  if (history.replaces && (!original || !["buy", "sell"].includes(original.data.event.type))) throw new Error("historical_original_missing");
  const affectedAt = new Date(Math.min(Date.parse(event.at), original ? Date.parse(original.data.event.at) : Infinity)).toISOString();
  return [...affected].sort().map(accountId => {
    const account = accounts.find(a => a.id === accountId);
    if (!account?.state || account.active === false) throw new Error("historical_account_unavailable");
    const rows = relevant.filter(e => e.accountId === accountId).sort((a,b) => a.data.state.sequence - b.data.state.sequence);
    const opening = rows[0];
    if (opening?.data.event.type !== "opening" || opening.data.state.sequence !== 0 || opening.data.state.startedAt !== account.state.startedAt) throw new Error("historical_opening_missing");
    if (accountId === input.accountId && Date.parse(event.at) <= Date.parse(opening.data.event.at)) throw new Error("trade_not_after_opening");
    if (accountId === input.accountId && event.dateEvidence?.precision === "date_only" && event.dateEvidence.reportedDate <= new Date(Date.parse(opening.data.event.at) + 9 * 3600000).toISOString().slice(0,10)) throw new Error("opening_day_order_unknown");
    const events = rows.slice(1).filter(e => e.id !== original?.id);
    if (events.some(e => e.data.event.type === "opening")) throw new Error("historical_opening_ambiguous");
    if (accountId === input.accountId) {
      const next = { id: input.operationId, accountId, operationId: input.operationId,
        data: { request: input, event: { ...event, id: input.operationId, source: "user_native_ledger", sequence: 0 } as NativeEvent, state: account.state, effect: null } };
      // A date-only event overlaps every event reported on that day. The caller
      // must supply the confirmed immediate predecessor; never sort to fit cash.
      const interval = (e: typeof event | NativeStoredEntry["data"]["event"]) => {
        if ("dateEvidence" in e && e.dateEvidence?.precision === "date_only") {
          const midpoint=Date.parse(e.dateEvidence.reportedDate+"T10:00:00Z");return [midpoint-12*3600000,midpoint+12*3600000-1];
        }
        return [Date.parse(e.at),Date.parse(e.at)];
      };
      const range=interval(event);
      const ties = events.filter(e => {const other=interval(e.data.event);return range[0]<=other[1] && other[0]<=range[1];});
      if (ties.length && !history.afterEventId) throw new Error("historical_order_required");
      events.sort((a,b) => Date.parse(a.data.event.at) - Date.parse(b.data.event.at) || a.data.state.sequence - b.data.state.sequence);
      if (history.afterEventId) {
        const predecessor = history.afterEventId === opening.id ? -1 : events.findIndex(e => e.id === history.afterEventId);
        if (predecessor === -1 && history.afterEventId !== opening.id) throw new Error("historical_order_invalid");
        events.splice(predecessor + 1, 0, next);
      } else {
        const index = events.findIndex(e => Date.parse(e.data.event.at) > Date.parse(event.at));
        events.splice(index < 0 ? events.length : index, 0, next);
      }
    }
    let state: NativePortfolioState = structuredClone(opening.data.state);
    const effective = [opening];
    for (const row of events) {
      if (row.data.event.type === "opening") throw new Error("historical_opening_ambiguous");
      const applied = applyNativeEvent(state, { ...row.data.event, sequence: state.sequence + 1 });
      if (!applied.ok) throw new Error("historical_replay_invalid");
      state = applied.next;
      effective.push({ ...row, data: { ...row.data, event: { ...row.data.event, sequence: state.sequence }, state,
        effect: { cashLegs: applied.cashLegs, quantityDelta: applied.quantityDelta, realized: applied.realized, execution: applied.execution } } } as NativeStoredEntry);
    }
    state = { ...state, sequence: account.state.sequence + 1 };
    effective[effective.length - 1] = { ...effective.at(-1)!, data: { ...effective.at(-1)!.data, state } };
    return { accountId, expectedState: account.state, expectedAssets: account.assets, next: state, effective, affectedAt };
  });
}
