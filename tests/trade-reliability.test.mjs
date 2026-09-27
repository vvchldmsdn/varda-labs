import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

// Pure modules only: no DB, credentials, provider calls, or browser session.
const [replay, recovery, engine] = await importWithPorts([
  "src/lib/native-ledger-replay.ts",
  "src/lib/trade-operation-recovery.ts",
  "src/lib/native-portfolio-ledger.ts",
], {});

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const A = id(1), B = id(2), ASSET = id(3), OPEN_A = id(10), OPEN_B = id(11), SALE = id(12), OP = id(20);
const START = "2026-05-01T00:00:00.000Z";
const MISSING = "2026-05-02T00:00:00.000Z";
const SOLD = "2026-05-03T00:00:00.000Z";
const zero = { amount: "0", currency: "USD" };

// All stored states and expected totals below are independent literal fixtures.
// No expected balance is obtained by invoking the reducer under test.
function state(accountId, quantity, cash, sequence, at, hasAsset = true) {
  return { version: 1, accountId, startedAt: START, at, sequence,
    cash: { KRW: "0", USD: cash },
    positions: hasAsset ? [{ assetId: ASSET, currency: "USD", quantity, costLots: null }] : [] };
}
function account(value) {
  return { id: value.accountId, name: value.accountId === A ? "Synthetic A" : "Synthetic B", active: true,
    state: value, assets: value.positions.map(position => ({ id: position.assetId, quantity: position.quantity,
      currency: position.currency, archived: position.quantity === "0", name: "Synthetic holding", ticker: "SYN", market: "us", assetType: "stock" })) };
}
function entry(entryId, value, event, cashLegs = []) {
  return { id: entryId, accountId: value.accountId, operationId: entryId,
    data: { request: { fixture: true }, event, state: value, effect: event.type === "opening" ? null : { cashLegs } } };
}
function trade(type, quantity, amount, at, overrides = {}) {
  return { type, assetId: ASSET, quantity, currency: "USD", settlement: { amount, currency: "USD" },
    fee: zero, tax: zero, at, ...overrides };
}
function basic(saleAt = SOLD) {
  const opening = state(A, "10", "1000", 0, START);
  const current = state(A, "7", "1330", 1, saleAt);
  return { accounts: [account(current)], entries: [
    entry(OPEN_A, opening, { type: "opening", at: START }),
    entry(SALE, current, trade("sell", "3", "330", saleAt, { id: SALE, sequence: 1, source: "synthetic_test" }), [{ currency: "USD", delta: "330", kind: "trade" }]),
  ] };
}
function mutation(overrides = {}) {
  return { accountId: A, operationId: OP, expectedSequence: 1,
    event: trade("buy", "2", "200", MISSING),
    history: { notInOpening: true, reason: "Synthetic omitted trade" }, ...overrides };
}
function run(fixture, input = mutation()) {
  const before = structuredClone({ fixture, input });
  const result = replay.replayNativeTrade(fixture.accounts, fixture.entries, input);
  assert.deepEqual({ fixture, input }, before, "replay must preserve original records and caller input");
  return result;
}
function expectReject(fixture, input, pattern) {
  const before = structuredClone({ fixture, input });
  assert.throws(() => replay.replayNativeTrade(fixture.accounts, fixture.entries, input), pattern);
  assert.deepEqual({ fixture, input }, before, "a failed replay must not partially modify either account");
}
function dated(day) {
  return { precision: "date_only", reportedDate: day, timeZone: "Asia/Seoul", policy: "service_day_midpoint" };
}

describe("historical native trade replay: independent financial expectations", () => {
  it("restores the missing 2-share USD 200 buy before a recorded 3-share USD 330 sale", () => {
    const fixture = basic(), result = run(fixture);
    assert.equal(result.length, 1);
    // 10 + 2 - 3 = 9 shares; 1000 - 200 + 330 = 1130 USD.
    assert.equal(result[0].next.positions[0].quantity, "9");
    assert.equal(result[0].next.cash.USD, "1130");
    assert.equal(result[0].next.cash.KRW, "0");
    assert.equal(result[0].next.positions[0].costLots, null, "unknown original basis remains unknown");
    assert.equal(result[0].next.sequence, 2);
    assert.equal(result[0].affectedAt, MISSING);
    assert.deepEqual(result[0].effective.map(row => row.id), [OPEN_A, OP, SALE]);
    assert.deepEqual(result[0].effective.slice(1).map(row => row.data.effect.cashLegs), [
      [{ currency: "USD", delta: "-200", kind: "trade" }],
      [{ currency: "USD", delta: "330", kind: "trade" }],
    ]);
    assert.deepEqual(run(fixture), result, "pure planning retries are deterministic; DB idempotency is tested separately");
  });

  it("corrects an existing sale without mutating its original quantity, total, or state", () => {
    const fixture = basic(), input = mutation({ event: trade("sell", "2", "230", SOLD),
      history: { notInOpening: true, reason: "Correct synthetic settlement", replaces: SALE } });
    const [change] = run(fixture, input);
    assert.equal(change.next.positions[0].quantity, "8");
    assert.equal(change.next.cash.USD, "1230");
    assert.equal(change.next.sequence, 2, "correction advances the durable command revision");
    assert.deepEqual(change.effective.map(row => row.id), [OPEN_A, OP]);
    assert.equal(fixture.entries[1].data.event.quantity, "3");
    assert.equal(fixture.entries[1].data.event.settlement.amount, "330");
    assert.equal(fixture.entries[1].data.state.cash.USD, "1330");
    assert.equal(change.affectedAt, SOLD);
  });

  it("uses the earlier of the original and corrected times as the invalidation boundary", () => {
    const [change] = run(basic(), mutation({ event: trade("sell", "2", "230", MISSING),
      history: { notInOpening: true, reason: "Correct synthetic date", replaces: SALE } }));
    assert.equal(change.affectedAt, MISSING);
    assert.equal(change.next.at, MISSING);
  });

  it("allows a normal writer to advance the replay marker, including after a repeated correction", () => {
    const first = run(basic(), mutation({ event: trade("sell", "2", "230", SOLD),
      history: { notInOpening: true, reason: "First correction", replaces: SALE } }))[0];
    const second = run({ accounts: [account(first.next)], entries: first.effective }, mutation({
      operationId: id(21), expectedSequence: 2, event: trade("sell", "1", "120", SOLD),
      history: { notInOpening: true, reason: "Second correction", replaces: OP },
    }))[0];
    assert.equal(second.next.sequence, 3);
    assert.equal(second.next.positions[0].quantity, "9");
    assert.equal(second.next.cash.USD, "1120");
    assert.equal(second.effective.length, 2, "correction does not append a second financial sale");
    const deposited = engine.applyNativeEvent(second.next, { id: id(22), source: "synthetic_test", type: "deposit",
      at: "2026-05-04T00:00:00.000Z", sequence: 4, currency: "USD", amount: "10" });
    assert.equal(deposited.ok, true);
    assert.equal(deposited.next.cash.USD, "1130");
    assert.equal(deposited.next.positions[0].quantity, "9");
  });

  it("rejects stale expected state instead of planning over a concurrent transaction", () => {
    expectReject(basic(), mutation({ expectedSequence: 0 }), /conflict/);
  });

  it("requires confirmation that the trade is not already included in opening balances", () => {
    expectReject(basic(), mutation({ history: { notInOpening: false, reason: "Already represented" } }), /opening_already_includes_trade/);
  });

  it("rejects trades at or before the trusted opening boundary", () => {
    for (const at of [START, "2026-04-30T23:59:59.999Z"]) {
      expectReject(basic(), mutation({ event: trade("buy", "2", "200", at) }), /trade_not_after_opening/);
    }
  });

  it("does not treat an opening-day date-only trade as safely after the opening", () => {
    expectReject(basic(), mutation({ event: trade("buy", "2", "200", "2026-05-01T10:00:00.000Z",
      { dateEvidence: dated("2026-05-01") }) }), /opening_day_order_unknown/);
  });

  it("rejects corrections to an opening or an absent original event", () => {
    for (const replaces of [OPEN_A, id(99)]) expectReject(basic(), mutation({
      history: { notInOpening: true, reason: "Invalid target", replaces },
    }), /historical_original_missing/);
  });

  it("does not make a negative historical cash path fit by inventing funding", () => {
    expectReject(basic(), mutation({ event: trade("buy", "20", "2000", MISSING) }), /historical_replay_invalid/);
  });
});

describe("date-only replay ordering uses the KST service interval", () => {
  const input = () => mutation({ event: trade("buy", "2", "200", "2026-05-03T10:00:00.000Z",
    { dateEvidence: dated("2026-05-03") }) });

  it("requires explicit ordering for 08:00 KST even though its UTC date differs", () => {
    expectReject(basic("2026-05-02T23:00:00.000Z"), input(), /historical_order_required/);
  });

  it("accepts the confirmed preceding sale and preserves date-only evidence", () => {
    const value = input(); value.history.afterEventId = SALE;
    const [change] = run(basic("2026-05-02T23:00:00.000Z"), value);
    assert.deepEqual(change.effective.map(row => row.id), [OPEN_A, SALE, OP]);
    assert.equal(change.next.cash.USD, "1130");
    assert.equal(change.next.positions[0].quantity, "9");
    assert.deepEqual(change.effective[2].data.event.dateEvidence, dated("2026-05-03"));
    assert.equal(change.effective[2].data.event.at, "2026-05-03T10:00:00.000Z");
  });

  it("includes 07:00 at the start and excludes 07:00 at the following boundary", () => {
    expectReject(basic("2026-05-02T22:00:00.000Z"), input(), /historical_order_required/);
    const [change] = run(basic("2026-05-03T22:00:00.000Z"), input());
    assert.deepEqual(change.effective.map(row => row.id), [OPEN_A, OP, SALE]);
    assert.equal(change.next.cash.USD, "1130");
  });

  it("also detects an exact new trade overlapping an existing date-only record", () => {
    const fixture = basic("2026-05-03T10:00:00.000Z");
    fixture.entries[1].data.event.dateEvidence = dated("2026-05-03");
    expectReject(fixture, mutation({ event: trade("buy", "2", "200", "2026-05-02T23:00:00.000Z") }), /historical_order_required/);
  });

  it("rejects an unknown predecessor instead of selecting a financially convenient order", () => {
    const value = input(); value.history.afterEventId = id(98);
    expectReject(basic("2026-05-02T23:00:00.000Z"), value, /historical_order_invalid/);
  });
});

function connected() {
  const outgoingId = id(30), incomingId = id(31), transferId = id(32), transferAt = MISSING;
  const openA = state(A, "10", "1000", 0, START), openB = state(B, "0", "50", 0, START, false);
  const outState = state(A, "10", "900", 1, transferAt), inState = state(B, "0", "150", 1, transferAt, false);
  const lastA = state(A, "7", "1230", 2, "2026-05-04T00:00:00.000Z");
  const transfer = { type: "transfer", at: transferAt, sequence: 1, id: transferId, transferId, source: "synthetic_test", currency: "USD", amount: "100" };
  return { accounts: [account(lastA), account(inState)], entries: [
    entry(OPEN_A, openA, { type: "opening", at: START }), entry(OPEN_B, openB, { type: "opening", at: START }),
    entry(outgoingId, outState, { ...transfer, direction: "out", peerAccountId: B }, [{ currency: "USD", delta: "-100", kind: "transfer" }]),
    entry(incomingId, inState, { ...transfer, direction: "in", peerAccountId: A }, [{ currency: "USD", delta: "100", kind: "transfer" }]),
    entry(SALE, lastA, trade("sell", "3", "330", lastA.at, { sequence: 2, id: SALE, source: "synthetic_test" }), [{ currency: "USD", delta: "330", kind: "trade" }]),
  ] };
}
function connectedMutation() { return mutation({ expectedSequence: 2, event: trade("buy", "2", "200", SOLD) }); }

describe("historical replay preserves connected account transfers", () => {
  it("replays both transfer-connected accounts without treating the transfer as external funding", () => {
    const changes = run(connected(), connectedMutation());
    assert.deepEqual(changes.map(change => change.accountId), [A, B]);
    assert.equal(changes[0].next.positions[0].quantity, "9");
    assert.equal(changes[0].next.cash.USD, "1030");
    assert.equal(changes[1].next.cash.USD, "150");
    assert.deepEqual(changes[1].next.positions, []);
    assert.equal(changes[0].next.sequence, 3); assert.equal(changes[1].next.sequence, 2);
    // Combined cash: 1000 + 50 - 200 + 330 = 1180, with zero net transfer.
    assert.equal(Number(changes[0].next.cash.USD) + Number(changes[1].next.cash.USD), 1180);
    const legs = changes.flatMap(change => change.effective.flatMap(row => row.data.effect?.cashLegs ?? []));
    assert.deepEqual(legs.filter(leg => leg.kind === "external"), []);
    assert.deepEqual(legs.filter(leg => leg.kind === "transfer").map(leg => leg.delta), ["-100", "100"]);
  });

  it("rejects a missing peer leg and preserves both existing account states", () => {
    const fixture = connected(); fixture.entries = fixture.entries.filter(row => row.id !== id(31));
    expectReject(fixture, connectedMutation(), /historical_transfer_evidence_missing/);
  });

  it("rejects an amount mismatch, duplicate peer leg, or unavailable peer account", () => {
    const mismatch = connected(); mismatch.entries.find(row => row.id === id(31)).data.event.amount = "101";
    expectReject(mismatch, connectedMutation(), /historical_transfer_evidence_missing/);
    const duplicate = connected(); duplicate.entries.push({ ...duplicate.entries.find(row => row.id === id(31)), id: id(33) });
    expectReject(duplicate, connectedMutation(), /historical_transfer_evidence_missing/);
    const unavailable = connected(); unavailable.accounts.find(row => row.id === B).active = false;
    expectReject(unavailable, connectedMutation(), /historical_account_unavailable/);
  });
});

function storage() {
  const values = new Map();
  return { get length() { return values.size; }, key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }, values };
}
const SUBJECT_A = "a".repeat(64), SUBJECT_B = "b".repeat(64), DAY = 24 * 60 * 60 * 1000;
const savedAt = Date.parse("2026-05-05T00:00:00.000Z");
const pending = (sessionKey = SUBJECT_A) => ({ sessionKey, mutation: mutation(), savedAt });

describe("durable pending-operation browser recovery", () => {
  it("survives remount by retaining the same operation and payload", () => {
    const local = storage(), value = pending(); recovery.rememberTrade(local, value);
    assert.deepEqual(recovery.pendingTrade(local, SUBJECT_A, savedAt + 1000), value);
    assert.equal(recovery.pendingTrade(local, SUBJECT_A, savedAt + 2000).mutation.operationId, OP);
    recovery.forgetTrade(local, SUBJECT_A);
    assert.equal(recovery.pendingTrade(local, SUBJECT_A, savedAt + 2000), null);
  });

  it("refuses dispatch preparation when browser writes are blocked or silently discarded", () => {
    for (const setItem of [() => { throw new Error("QuotaExceededError"); }, () => {}]) {
      const local = storage(); local.setItem = setItem;
      assert.throws(() => recovery.rememberTrade(local, pending()), /recovery_storage_unavailable/);
      assert.equal(local.length, 0);
    }
  });

  it("never returns or deletes another signed-in subject's pending request", () => {
    const local = storage(); recovery.rememberTrade(local, pending());
    assert.equal(recovery.pendingTrade(local, SUBJECT_B, savedAt + 1000), null);
    recovery.forgetTrade(local, SUBJECT_B);
    assert.deepEqual(recovery.pendingTrade(local, SUBJECT_A, savedAt + 1000), pending());
  });

  it("does not let a second tab overwrite a different unconfirmed operation", () => {
    const local = storage(), first = pending(); recovery.rememberTrade(local, first);
    const another = pending(); another.mutation.operationId = id(90);
    assert.throws(() => recovery.rememberTrade(local, another), /recovery_pending/);
    assert.deepEqual(recovery.pendingTrade(local, SUBJECT_A, savedAt + 1000), first);
  });

  it("a stale completion cannot erase a different pending operation", () => {
    const local = storage(); recovery.rememberTrade(local, pending());
    recovery.forgetTrade(local, SUBJECT_A, id(90));
    assert.equal(recovery.pendingTrade(local, SUBJECT_A, savedAt + 1000).mutation.operationId, OP);
    recovery.forgetTrade(local, SUBJECT_A, OP);
    assert.equal(recovery.pendingTrade(local, SUBJECT_A, savedAt + 1000), null);
  });

  it("retains the draft through exactly 24 hours, then preserves only recovery identity", () => {
    const local = storage(); recovery.rememberTrade(local, pending());
    assert.ok("mutation" in recovery.pendingTrade(local, SUBJECT_A, savedAt + DAY));
    const expired = recovery.pendingTrade(local, SUBJECT_A, savedAt + DAY + 1);
    assert.equal(expired.expired, true); assert.equal(expired.operationId, OP);
    assert.equal(expired.sessionKey, SUBJECT_A); assert.equal("mutation" in expired, false);
    const stored = [...local.values.values()].join("");
    assert.equal(stored.includes(ASSET), false); assert.equal(stored.includes("settlement"), false);
    assert.equal(stored.includes("Synthetic omitted trade"), false);
  });

  it("scrubs expired foreign drafts without exposing their content to the new subject", () => {
    const local = storage(); recovery.rememberTrade(local, pending());
    assert.equal(recovery.pendingTrade(local, SUBJECT_B, savedAt + DAY + 1), null);
    const retained = [...local.values.values()].map(value => JSON.parse(value));
    assert.equal(retained.length, 1); assert.equal(retained[0].operationId, OP);
    assert.equal("mutation" in retained[0], false);
  });

  it("never deletes recovery identity when expiry cleanup cannot persist",()=>{
    const local=storage();recovery.rememberTrade(local,pending());
    local.setItem=()=>{throw new Error("QuotaExceededError");};
    assert.throws(()=>recovery.pendingTrade(local,SUBJECT_A,savedAt+DAY+1),/recovery_storage_unavailable/);
    assert.equal([...local.values.values()].map(JSON.parse)[0].mutation.operationId,OP);
    assert.equal(recovery.pendingTrade(local,SUBJECT_B,savedAt+DAY+1),null);
  });

  it("keeps unresolved identity after 30 days without retaining financial input", () => {
    const local = storage(); recovery.rememberTrade(local, pending());
    const old = recovery.pendingTrade(local, SUBJECT_A, savedAt + 30 * DAY + 1);
    assert.equal(old.operationId, OP); assert.equal(old.expired, true);
    assert.equal("mutation" in old, false);
    assert.equal([...local.values.values()].join("").includes("settlement"), false);
    // Completion verification, not elapsed time, permits forgetting the operation.
    recovery.forgetTrade(local, SUBJECT_A, OP);
    assert.equal(recovery.pendingTrade(local, SUBJECT_A, savedAt + 30 * DAY + 1), null);
    assert.equal(local.length, 0);
  });
});
