import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNativeCutoffEvidence } from "../src/lib/snapshots/native-cutoff-evidence.ts";

const at = "2026-09-21T21:59:00Z";
const capturedAt = "2026-09-21T22:20:00Z";
const snapshotDate = "2026-09-22";
const position = source => ({ id: "asset", ownerId: "owner", accountId: "account", ticker: "TEST", market: "us", name: "Synthetic",
  observation: { quantity: "10", price: "105", currency: "USD", at, priceObservedAt: at, priceFetchedAt: at, source, basis: "raw", priceKind: "live", timestampBasis: "provider" } });
const fx = source => ({ base: "USD", quote: "KRW", rate: "1300", observedAt: at, fetchedAt: at, source, kind: "spot" });
function fixture() {
  const state = { sequence: 0, accountId: "account", cash: { KRW: "0", USD: "0" }, positions: [{ assetId: "asset", quantity: "10", currency: "USD", costLots: null }] };
  const ledger = { accounts: [{ id: "account", name: "Synthetic", state, assets: [{ id: "asset", name: "Synthetic", ticker: "TEST", market: "us", currency: "USD" }] }],
    entries: [{ accountId: "account", data: { event: { type: "opening", at: "2026-09-01T00:00:00Z" }, state } }], snapshots: [], observations: [] };
  const base = { ownerId: "owner", reporting: "USD", asOf: capturedAt, current: { at, source: "current_admission", scopeComplete: false, positions: [] }, fx: [] };
  const saved = (positions, rates = []) => ({ accountId: "account", evidence: { version: 1, sequence: 0, frame: { at, source: "prior_capture", scopeComplete: true, positions }, fx: rates } });
  return { base, ledger, saved, run: () => buildNativeCutoffEvidence(base, ledger, snapshotDate, capturedAt) };
}
describe("cutoff observation reuse respects current provider admission", () => {
  it("rejects conflicting live prices across current and archived KIS receipts", () => {
    const f=fixture();f.base.current.positions.push(position("kis_overseas_price:NAS"));
    const other=position("kis_overseas_price:NAS");other.observation.price="110";
    f.ledger.snapshots.push(f.saved([other]));
    assert.equal(f.run().current.positions.find(row=>row.id==="asset").observation,null);
    const close=position("kis_overseas_dailyprice:NAS");
    Object.assign(close.observation,{price:"100",priceKind:"close",timestampBasis:"daily_close",priceReferenceDate:"2026-09-21"});
    f.ledger.snapshots.push(f.saved([close]));
    assert.equal(f.run().current.positions.find(row=>row.id==="asset").observation.price,"100");
  });
  it("does not resurrect a licensed quote from a previous intraday capture", () => {
    const f = fixture();
    f.ledger.snapshots.push(f.saved([position("twelve_data:TEST")]));
    f.ledger.observations.push(f.saved([position("twelve_data:TEST")]));
    assert.equal(f.run().current.positions.find(row => row.id === "asset").observation, null);
  });
  it("keeps an explicitly admitted current licensed observation", () => {
    const f = fixture();
    f.base.current.positions.push(position("twelve_data:TEST"));
    f.base.fx.push(fx("twelve_data"));
    const result = f.run();
    assert.equal(result.current.positions.find(row => row.id === "asset").observation.price, "105");
    assert.equal(result.fx[0].source, "twelve_data");
  });
  it("retains a valid saved KIS quote without deriving current shares", () => {
    const f = fixture();
    const old = position("kis_overseas_price:NAS"); old.observation.quantity = "99";
    f.ledger.snapshots.push(f.saved([old]));
    assert.equal(f.run().current.positions.find(row => row.id === "asset").observation.quantity, "10");
  });
  it("requires current admission for every unrecognized archived FX provider", () => {
    const f = fixture();
    f.ledger.observations.push(f.saved([], [fx("twelve_data"), fx("other_licensed_provider")]));
    assert.deepEqual(f.run().fx, []);
  });
  it("retains existing KIS and public-reference FX receipts", () => {
    const f = fixture();
    f.ledger.observations.push(f.saved([], [fx("kis"), { ...fx("er-api_open_access"), kind: "daily_reference" }]));
    assert.deepEqual(f.run().fx.map(row => row.source), ["kis", "er-api_open_access"]);
  });
});
