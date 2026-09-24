import assert from "node:assert/strict";
import { it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const [{ admitNativeKrwEconomic }] = await importWithPorts(["src/lib/native-economic-admission.ts"], {});
const at = "2026-09-15T01:00:00.000Z";
const position = (id, currency, market, ticker, quantity, price, kind = "holding") => ({ id, ownerId: "owner", name: id, market, ticker, kind, cost: null,
  observation: { at, priceObservedAt: at, quantity: String(quantity), price: String(price), currency, source: "native_observed", basis: "raw" } });
function fixture() {
  const evidence = { ownerId: "owner", reporting: "KRW", asOf: at, ledgerComplete: true, trades: [], history: [], cashFlows: [], maxPriceAgeMs: 0, maxFxAgeMs: 0,
    current: { at, source: "native_ledger", scopeComplete: true, positions: [position("us-1", "USD", "us", "VOO", 1, 100), position("us-2", "USD", "us", "VOO", 1, 100), position("kr", "KRW", "korea", "069500", 3, 40000), position("cash-usd", "USD", "cash", null, 0, 1, "cash"), position("cash-krw", "KRW", "cash", null, 0, 1, "cash")] },
    fx: [{ base: "USD", quote: "KRW", rate: "1300", observedAt: at, fetchedAt: at, source: "dated_fx", kind: "spot" }] };
  const instruments = [{ instrumentKey: "us:USD:VOO", currentValueKrw: 260000, weightBps: 6842 }, { instrumentKey: "korea:KRW:069500", currentValueKrw: 120000, weightBps: 3158 }];
  return { evidence, research: { inputPreflight: { instruments }, execution: { executionWeights: instruments.map(({ instrumentKey, weightBps }) => ({ instrumentKey, weightBps })) } } };
}

it("reuses KRW economics only for exact native security values and full weights with zero cash", () => {
  const { evidence, research } = fixture();
  assert.deepEqual(admitNativeKrwEconomic(evidence, research), { ready: true, reason: null });
  evidence.reporting = "USD";
  assert.equal(admitNativeKrwEconomic(evidence, research).reason, "usd_economic_policy_unvalidated");
});

it("never removes a positive native cash balance to fit the security-only model", () => {
  const { evidence, research } = fixture();
  evidence.current.positions[3].observation.quantity = "0.01";
  assert.equal(admitNativeKrwEconomic(evidence, research).reason, "native_cash_component_not_supported");
  evidence.current.positions[3].observation = null;
  assert.equal(admitNativeKrwEconomic(evidence, research).reason, "native_valuation_incomplete");
});

it("blocks unmatched values, omitted holdings, wrong weights and duplicate execution identities", () => {
  let { evidence, research } = fixture(); research.inputPreflight.instruments[0].currentValueKrw += 1;
  assert.equal(admitNativeKrwEconomic(evidence, research).ready, false);
  ({ evidence, research } = fixture()); research.inputPreflight.instruments.pop();
  assert.equal(admitNativeKrwEconomic(evidence, research).ready, false);
  ({ evidence, research } = fixture()); research.execution.executionWeights[0].weightBps = 10000;
  assert.equal(admitNativeKrwEconomic(evidence, research).ready, false);
  ({ evidence, research } = fixture()); research.execution.executionWeights[1] = research.execution.executionWeights[0];
  assert.equal(admitNativeKrwEconomic(evidence, research).ready, false);
});

it("blocks incomplete ledgers, mixed owners and absent dated FX before economic reuse", () => {
  let { evidence, research } = fixture(); evidence.ledgerComplete = false;
  assert.equal(admitNativeKrwEconomic(evidence, research).reason, "native_valuation_incomplete");
  ({ evidence, research } = fixture()); evidence.current.positions[0].ownerId = "other";
  assert.equal(admitNativeKrwEconomic(evidence, research).ready, false);
  ({ evidence, research } = fixture()); evidence.fx = [];
  assert.equal(admitNativeKrwEconomic(evidence, research).reason, "native_valuation_incomplete");
});
