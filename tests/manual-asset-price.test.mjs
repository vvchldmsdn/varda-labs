import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  isKrxGoldManualAssetCandidate,
  KRX_GOLD_MANUAL_ASSET_BINDING,
  MANUAL_ASSET_PRICE_POLICY,
  buildManualAssetPriceUpdate,
  parseManualAssetPriceInput,
} from "../src/lib/market-data/manual-asset-price.ts";

describe("manual asset price", () => {
  it("records a forward-only manual valuation with explicit provenance", () => {
    const recordedAt = new Date("2026-07-19T02:03:04.000Z");
    const update = buildManualAssetPriceUpdate({
      currentPrice: "192000.0000",
      recordedAt,
    });

    assert.deepEqual(MANUAL_ASSET_PRICE_POLICY, {
      version: "manual_asset_price_v1",
      source: "manual_entry",
      quoteType: "manual_valuation",
      status: "stored_manual",
      carryPolicy: "retain_until_next_manual_update",
      historyPolicy: "forward_only_no_backcast",
    });
    assert.deepEqual(update, {
      currentPrice: "192000.0000",
      priceSource: "manual_entry",
      priceFetchedAt: null,
      priceAsOf: recordedAt,
      priceQuoteType: "manual_valuation",
      priceStatus: "stored_manual",
      priceError: null,
    });
    assert.notEqual(update.priceAsOf, recordedAt);
    assert.ok(Object.isFrozen(update));
  });

  it("rejects an invalid manual valuation timestamp", () => {
    assert.throws(
      () =>
        buildManualAssetPriceUpdate({
          currentPrice: "192000",
          recordedAt: new Date("invalid"),
        }),
      /recordedAt must be a valid Date/,
    );
  });

  it("validates a bounded KRW-per-gram input without accepting formatted text", () => {
    assert.deepEqual(parseManualAssetPriceInput("192000"), {
      ok: true,
      currentPrice: "192000",
    });
    assert.deepEqual(parseManualAssetPriceInput("192000.1250"), {
      ok: true,
      currentPrice: "192000.1250",
    });
    assert.deepEqual(parseManualAssetPriceInput("192,000"), {
      ok: false,
      reason: "invalid_price",
    });
    assert.deepEqual(parseManualAssetPriceInput("0"), {
      ok: false,
      reason: "price_out_of_range",
    });
    assert.deepEqual(parseManualAssetPriceInput("100000001"), {
      ok: false,
      reason: "price_out_of_range",
    });
  });

  it("binds the editor only to the reviewed KRX gold holding shape", () => {
    const candidate = {
      accountCode: "brokerage",
      name: "금현물",
      ticker: null,
      assetType: "commodity",
      market: "korea",
      currency: "KRW",
    };

    assert.equal(KRX_GOLD_MANUAL_ASSET_BINDING.quoteUnit, "KRW_PER_G");
    assert.equal(isKrxGoldManualAssetCandidate(candidate), true);
    assert.equal(
      isKrxGoldManualAssetCandidate({ ...candidate, accountCode: "isa" }),
      false,
    );
    assert.equal(
      isKrxGoldManualAssetCandidate({ ...candidate, ticker: "411060" }),
      false,
    );
  });

  it("uses a session-owned Server Action instead of the machine-admin API", () => {
    const actionSource = readFileSync(
      new URL("../src/app/portfolio/holdings/actions.ts", import.meta.url),
      "utf8",
    );
    const writerSource = readFileSync(
      new URL(
        "../src/lib/market-data/manual-krx-gold-price-write.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const formSource = readFileSync(
      new URL(
        "../src/components/manual-krx-gold-price-form.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/app/portfolio/holdings/page.tsx", import.meta.url),
      "utf8",
    );

    assert.match(actionSource, /^"use server";/);
    assert.match(actionSource, /writeSessionManualKrxGoldPrice/);
    assert.match(actionSource, /revalidatePath/);
    assert.doesNotMatch(actionSource, /requireAdminJob|fetch\s*\(|\/api\//);
    assert.doesNotMatch(
      actionSource,
      /formData\.get\(["'](?:owner|assetId|accountId|canonicalOwner)/,
    );
    assert.match(writerSource, /^import "server-only";/);
    assert.match(writerSource, /resolveCurrentTenantContext\(\)/);
    assert.match(writerSource, /accounts\.canonicalOwnerUserId/);
    assert.match(writerSource, /assets\.canonicalOwnerUserId/);
    assert.match(writerSource, /prepareTenantWriteContext/);
    assert.match(writerSource, /assertActiveTenantWriteAllowed/);
    assert.match(writerSource, /buildManualAssetPriceUpdate/);
    assert.doesNotMatch(writerSource, /requireAdminJob|fetch\s*\(|\/api\//);
    assert.match(formSource, /^"use client";/);
    assert.match(formSource, /useActionState/);
    assert.doesNotMatch(formSource, /fetch\s*\(|\/api\//);
    assert.match(pageSource, /isKrxGoldManualAssetCandidate/);
    assert.match(pageSource, /ManualKrxGoldPriceForm/);
  });

  it("keeps the current CRUD boundary admin-protected", () => {
    const routeSource = readFileSync(
      new URL("../src/app/api/entities/assets/[id]/route.ts", import.meta.url),
      "utf8",
    );

    assert.match(routeSource, /requireAdminJob\(request\)/);
    assert.match(routeSource, /buildManualAssetPriceUpdate/);
    assert.doesNotMatch(routeSource, /FSC_PUBLIC_DATA_SERVICE_KEY/);
  });
});
