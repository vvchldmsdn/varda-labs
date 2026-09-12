import assert from "node:assert/strict";
import { it } from "node:test";
import { analyzeQuickPortfolio, validateQuickPortfolio, createQuickDraft, parseQuickDraft } from "../src/lib/quick-portfolio.ts";
const input = { currency: "KRW", rows: [{ name: "VOO", value: 600000, instrumentId: "us-voo" }, { name: "내 자산", value: 400000, instrumentId: null }] };
it("derives only composition from values, preserving unknown identity and currency", () => {
  const result = analyzeQuickPortfolio(input);
  assert.equal(result.total, 1000000); assert.equal(result.largest.weightPct, 60);
  assert.deepEqual(result.currencies.map(row => [row.name, row.weightPct]), [["USD", 60], ["미확인", 40]]);
  assert.equal(result.rows[1].instrument, null);
  assert.equal(analyzeQuickPortfolio({ currency: "KRW", rows: [{ name: "VOO", value: 10, instrumentId: null }] }).currencies[0].name, "미확인");
});
it("supports one asset, several assets, zero rows and max values without fabricating risk", () => {
  assert.equal(analyzeQuickPortfolio({ currency: "KRW", rows: [{ name: "A", value: 1, instrumentId: null }] }).largest.weightPct, 100);
  const result = analyzeQuickPortfolio({ currency: "KRW", rows: [{ name: "A", value: 0, instrumentId: null }, { name: "B", value: 1000000000000, instrumentId: null }] });
  assert.equal(result.rows[0].weightPct, 0); assert.equal(result.largest.name, "B");
  assert.equal(Object.hasOwn(result, "risk"), false); assert.equal(Object.hasOwn(result, "expectedReturn"), false);
});
it("rejects unsafe money, duplicates, missing names, spoofed catalogue and currency", () => {
  for (const value of [-1, 1.2, NaN, Infinity, 1000000000001, "1000"]) assert.equal(validateQuickPortfolio({ ...input, rows: [{ ...input.rows[0], value }] }).ok, false);
  for (const rows of [[], Array(13).fill(input.rows[0]), [{ name: "", value: 1, instrumentId: null }], [{ name: "VOO", value: 0, instrumentId: "us-voo" }], [{ name: "VOO", value: 1, instrumentId: "wrong" }], [{ name: "fake", value: 1, instrumentId: "us-voo" }], [{ name: "A", value: 1, instrumentId: null }, { name: "a", value: 1, instrumentId: null }]]) assert.equal(validateQuickPortfolio({ ...input, rows }).ok, false);
  assert.equal(validateQuickPortfolio({ ...input, currency: "USD" }).ok, false);
});
it("restores 24h draft, preserves retry identity, expires and normalizes fields", () => {
  const draft = createQuickDraft(input); assert.deepEqual(parseQuickDraft(JSON.stringify(draft)), draft);
  assert.equal(createQuickDraft(input, draft).id, draft.id);
  assert.notEqual(createQuickDraft({ ...input, rows: [{ ...input.rows[0], value: 20 }] }, draft).id, draft.id);
  assert.equal(parseQuickDraft(JSON.stringify(draft), draft.expiresAt), null);
  assert.equal(parseQuickDraft(JSON.stringify({ ...draft, id: "invalid" })), null);
  assert.equal(parseQuickDraft("bad"), null);
  const parsed = validateQuickPortfolio({ ...input, secret: "discard", rows: input.rows.map(row => ({ ...row, quantity: 20 })) });
  assert.deepEqual(parsed.input, input);
});
