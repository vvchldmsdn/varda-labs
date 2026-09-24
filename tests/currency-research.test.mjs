import assert from "node:assert/strict";
import { it } from "node:test";
import { buildCurrencyResearch, CURRENCY_RESEARCH_POLICY } from "../src/lib/currency-research.ts";
import { currencyResearchFixture } from "../src/lib/currency-research-fixture.ts";

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const short = () => ({ ...currencyResearchFixture(), horizon: 12 });
const admittedSinglePrice = () => {
  const input = short(), history = input.histories[1];
  input.input.rows = [{ ...input.input.rows[1], value: 100, inputCurrency: "USD" }];
  input.input.currency = "USD"; input.reportingCurrency = "USD"; input.fx = [];
  input.provenance = "stored_market_history"; input.histories = [history];
  history.admission = "provider_adjusted";
  history.corporateActions = { ...history.corporateActions, status: "verified_split_adjusted", source: "test_verified_provider_adjustment" };
  history.points.forEach(point => { point.price = "50"; point.basis = "split_adjusted"; point.dataset = "test_split_adjusted_price_only"; });
  return input;
};

it("calculates 1000 deterministic hypothetical paths, composition and matched-date risk", async () => {
  const input = short();
  const first = await buildCurrencyResearch(input), second = await buildCurrencyResearch(input);
  assert.equal(first.status, "ready"); assert.equal(first.composition.total, 10000000);
  assert.equal(first.simulation.paths.length, 1000); assert.equal(first.simulation.paths[0].length, 13);
  assert.deepEqual(first.simulation.paths, second.simulation.paths);
  assert.equal(first.metadata.cacheIdentity, second.metadata.cacheIdentity);
  assert.equal(first.risk.sharpe, null); assert.equal(first.risk.beta, null);
  assert.ok(first.risk.observations >= 30); assert.equal(first.metadata.source, "synthetic_fixture");
  assert.equal(first.metadata.policy.purpose, "current_amount_composition_hypothetical");
  assert.equal(Object.hasOwn(first, "actualHistory"), false);
});

it("recalculates dates before returns: flat native USD has FX return in KRW and none in USD", async () => {
  const input = short(); input.input.rows = [input.input.rows[1]]; input.histories = [input.histories[1]];
  input.histories[0].points.forEach(point => { point.price = "100"; });
  const krw = await buildCurrencyResearch(input), usd = await buildCurrencyResearch({ ...input, reportingCurrency: "USD" });
  assert.equal(krw.status, "ready"); assert.equal(usd.status, "ready");
  assert.ok(Math.abs(krw.lab.currentReturnPct) > .1); close(usd.lab.currentReturnPct, 0);
  assert.notEqual(krw.metadata.cacheIdentity, usd.metadata.cacheIdentity);
  close(usd.composition.total, 3000000 / Number(input.fx.at(-1).rate));
  assert.equal(usd.risk.volatilityPct, 0);
});

it("uses inverse dated FX for KRW prices in a USD analysis", async () => {
  const input = short(); input.input.rows = [input.input.rows[0]]; input.histories = [input.histories[0]];
  input.histories[0].points.forEach(point => { point.price = "100"; });
  const result = await buildCurrencyResearch({ ...input, reportingCurrency: "USD" });
  close(result.lab.currentReturnPct, (Number(input.fx[0].rate) / Number(input.fx.at(-1).rate) - 1) * 100);
});

it("does not use current manual FX to backfill historical gaps", async () => {
  const input = short(); const at = input.input.asOf;
  input.input.fx = [{ base: "USD", quote: "KRW", rate: "1400", observedAt: at, fetchedAt: at, source: "manual", kind: "user_input" }];
  input.fx = [];
  const result = await buildCurrencyResearch(input);
  assert.equal(result.status, "incomplete"); assert.equal(result.simulation, null);
  assert.ok(result.issues.some(issue => issue.code === "fx_missing"));
});

it("preserves unconvertible amounts and unknown holdings without renormalizing", async () => {
  const input = short(); input.input.rows[1].inputCurrency = "USD"; input.fx = [];
  const result = await buildCurrencyResearch(input);
  assert.equal(result.composition.total, null); assert.ok(result.composition.rows.every(row => row.weight === null));
  assert.equal(result.risk, null);
  const unknown = short(); unknown.input.rows.push({ name: "알 수 없는 자산", value: 10000000, instrumentId: null, inputCurrency: "KRW" });
  const other = await buildCurrencyResearch(unknown);
  close(other.composition.rows[0].weight, .25); assert.equal(other.simulation, null);
  assert.ok(other.issues.some(issue => issue.code === "instrument_unidentified"));
});

it("blocks mismatched dates instead of intersecting away missing observations", async () => {
  const input = short(); input.histories[1].points.splice(20, 1);
  const result = await buildCurrencyResearch(input);
  assert.equal(result.status, "incomplete"); assert.equal(result.lab, null);
  assert.ok(result.issues.some(issue => issue.code === "history_axis_mismatch"));
});

it("does not allow development histories into stored-market calculations", async () => {
  const result = await buildCurrencyResearch({ ...short(), provenance: "stored_market_history" });
  assert.equal(result.simulation, null); assert.ok(result.issues.some(issue => issue.code === "history_admission_mismatch"));
});

it("blocks stale, duplicate and incompatible price basis evidence", async () => {
  const stale = short(); stale.asOf = "2026-10-11T00:00:00Z";
  assert.ok((await buildCurrencyResearch(stale)).issues.some(issue => issue.code === "history_stale"));
  const duplicate = short(); duplicate.histories.push(duplicate.histories[0]);
  assert.ok((await buildCurrencyResearch(duplicate)).issues.some(issue => issue.code === "duplicate_instrument_history"));
  const mixed = short(); mixed.histories[0].points[10].basis = "total_return";
  assert.ok((await buildCurrencyResearch(mixed)).issues.some(issue => issue.code === "price_basis_mismatch"));
});

it("compares user-selected weights using the same joint date matrix", async () => {
  const input = short();
  const original = await buildCurrencyResearch(input);
  const alternative = await buildCurrencyResearch({ ...input, comparisonWeights: [0, 1, 0] });
  assert.notEqual(original.lab.comparisonReturnPct, alternative.lab.comparisonReturnPct);
  assert.equal(original.lab.currentReturnPct, alternative.lab.currentReturnPct);
  assert.deepEqual(original.simulation.paths, alternative.simulation.paths);
  assert.notEqual(original.metadata.cacheIdentity, alternative.metadata.cacheIdentity);
  const invalid = await buildCurrencyResearch({ ...input, comparisonWeights: [.4, .4, 0] });
  assert.ok(invalid.issues.some(issue => issue.code === "comparison_weights_invalid"));
});

it("joint sampling preserves offsetting asset moves at every simulation step", async () => {
  const input = short(); input.input.rows = input.input.rows.slice(0, 2).map(row => ({ ...row, value: 1000000 }));
  input.histories = input.histories.slice(0, 2); input.reportingCurrency = "USD";
  let first = 100, second = 100;
  input.histories.forEach((history, asset) => history.points.forEach((point, i) => {
    const change = i % 2 === 0 ? .01 : -.01;
    if (i > 0) { if (asset === 0) first *= 1 + change; else second *= 1 - change; }
    const native = asset === 0 ? first * Number(input.fx[i].rate) : second;
    point.price = String(native);
  }));
  const result = await buildCurrencyResearch(input);
  assert.equal(result.status, "ready");
  for (const path of result.simulation.paths) for (const value of path) close(value, 1, 1e-10);
});

it("identity changes when provenance, valuation date or historical FX evidence changes", async () => {
  const input = short(); const original = await buildCurrencyResearch(input);
  const changed = structuredClone(input); changed.fx[10].rate = String(Number(changed.fx[10].rate) + 10);
  assert.notEqual((await buildCurrencyResearch(changed)).metadata.cacheIdentity, original.metadata.cacheIdentity);
  changed.asOf = "2026-09-12T00:00:00Z";
  assert.notEqual((await buildCurrencyResearch(changed)).metadata.cacheIdentity, original.metadata.cacheIdentity);
  assert.equal(CURRENCY_RESEARCH_POLICY.missing, "block_without_dropping_or_renormalizing");
});

it("preserves zero-weight unknown rows without manufacturing quantities", async () => {
  const input = short(); input.input.rows.push({ name: "나중에 추가할 자산", value: 0, instrumentId: null, inputCurrency: "KRW" });
  const result = await buildCurrencyResearch(input);
  assert.equal(result.status, "ready"); assert.equal(result.composition.rows.at(-1).weight, 0);
  assert.ok(result.composition.rows.every(row => !Object.hasOwn(row, "quantity")));
});
it("blocks raw stored prices without corporate-action coverage instead of modeling a split as loss", async () => {
  const input = admittedSinglePrice();
  input.histories[0].admission = "shared_kis_raw";
  input.histories[0].points.forEach((point, index) => { point.basis = "raw_price"; point.price = index < 40 ? "100" : "50"; });
  delete input.histories[0].corporateActions;
  const result = await buildCurrencyResearch(input);
  assert.equal(result.status, "incomplete"); assert.equal(result.lab, null); assert.equal(result.simulation, null);
  assert.ok(result.issues.some(issue => issue.code === "corporate_action_evidence_missing"));
});
it("uses supplied verified split-adjusted prices once: a 2:1 split alone causes no loss", async () => {
  // Provider normalized the pre-split $100 and post-split $50 to $50 throughout.
  const input = admittedSinglePrice(), result = await buildCurrencyResearch(input);
  assert.equal(result.status, "ready"); close(result.lab.currentReturnPct, 0);
  assert.ok(result.simulation.paths.every(path => path.every(value => value === 1)));
  input.histories[0].corporateActions.through = input.histories[0].points[40].at;
  assert.ok((await buildCurrencyResearch(input)).issues.some(issue => issue.code === "corporate_action_evidence_missing"));
});
it("split-adjusted price returns do not silently add dividends or splice provider datasets", async () => {
  const input = admittedSinglePrice(); input.histories[0].points.at(-1).price = "49.5";
  const result = await buildCurrencyResearch(input); close(result.lab.currentReturnPct, -1);
  assert.deepEqual(result.metadata.bases, ["split_adjusted"]);
  input.histories[0].points.at(-1).dataset = "different_provider_basis";
  const blocked = await buildCurrencyResearch(input); assert.equal(blocked.lab, null);
  assert.ok(blocked.issues.some(issue => issue.code === "price_basis_mismatch"));
});
