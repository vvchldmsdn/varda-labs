import assert from "node:assert/strict";
import { it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
const [m] = await importWithPorts(["src/lib/trade-record-intent.ts"], {});
const accountId = "11111111-1111-4111-8111-111111111111", assetId = "44444444-4444-4444-8444-444444444444";
const accounts = [{ id: accountId, assets: [{ id: assetId }] }];
it("keeps a generic buy or sell intent without a preselected account", () => {
  for (const action of ["buy", "sell"]) assert.deepEqual(m.resolveTradeRecordSelection(accounts, { action }), { accountId: "", assetId: "", action });
});
it("resolves holding hints only within an authenticated active account", () => {
  assert.deepEqual(m.resolveTradeRecordSelection(accounts, { accountId, assetId, action: "sell" }), { accountId, assetId, action: "sell" });
  assert.equal(m.resolveTradeRecordSelection([{ ...accounts[0], active: false }], { accountId, assetId, action: "sell" }).assetId, "");
  assert.equal(m.resolveTradeRecordSelection(accounts, { accountId: "22222222-2222-4222-8222-222222222222", assetId, action: "buy" }).assetId, "");
});
it("preserves only safe internal navigation fields through authentication", () => {
  assert.equal(m.tradeRecordHref({ accountId, assetId, action: "sell" }), "/portfolio/ledger?accountId=" + accountId + "&assetId=" + assetId + "&action=sell");
  assert.equal(m.tradeRecordHref({ accountId: "https://evil.invalid", assetId, action: "https://evil.invalid" }), "/portfolio/ledger");
  assert.equal(m.normalizeTradeRecordHint({ action: ["buy", "sell"] }).action, undefined);
});
it("continues the intended holding after opening balances but clears transaction amounts", () => {
  const fields = { assetId, currency: "USD", quantity: "2", price: "100", cashUsd: "1000", fee: "1" };
  assert.deepEqual(m.fieldsAfterLedgerSave(fields, true, "time"), { assetId, currency: "USD", at: "time", assetType: "etf" });
  assert.deepEqual(m.fieldsAfterLedgerSave(fields, false, "time"), { currency: "USD", at: "time", assetType: "etf" });
});

it("retains a selected new instrument through the opening step", () => {
  const result=m.fieldsAfterLedgerSave({assetId:"new",name:"Example",ticker:"EXAMPLE",currency:"USD",assetType:"stock",inputMode:"total",cashUsd:"100"},true,"time");
  assert.equal(result.name,"Example");assert.equal(result.ticker,"EXAMPLE");assert.equal(result.inputMode,"total");assert.equal(result.cashUsd,undefined);
});
