import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  KRX_GOLD_CLOSE_ONLY_CONTRACT,
  buildInstrumentSemanticKey,
  classifyKrxGoldCloseMovement,
  resolveKrxGoldCloseEvidence,
} from "../src/lib/instrument-identity.ts";

describe("KRX gold close-only instrument contract", () => {
  it("uses a ticker-independent semantic identity and official close policy", () => {
    assert.deepEqual(KRX_GOLD_CLOSE_ONLY_CONTRACT.identity, {
      instrumentKind: "commodity_spot",
      venue: "KRX_GOLD",
      productKey: "gold_9999_1kg",
      holdingUnit: "g",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_G",
    });
    assert.deepEqual(KRX_GOLD_CLOSE_ONLY_CONTRACT.pricing, {
      mode: "official_close_only",
      source: "krx_open_api_gold_daily",
      quoteKind: "official_close",
      liveQuoteEligible: false,
    });
    assert.doesNotMatch(
      JSON.stringify(KRX_GOLD_CLOSE_ONLY_CONTRACT),
      /ticker|kiwoom|kis|live_price/i,
    );
  });

  it("keeps KRX gold spot distinct from ETF, futures, and reference prices", () => {
    const goldSpot = buildInstrumentSemanticKey(
      KRX_GOLD_CLOSE_ONLY_CONTRACT.identity,
    );
    const aceGoldEtf = buildInstrumentSemanticKey({
      instrumentKind: "etf",
      venue: "KRX_SECURITIES",
      productKey: "411060",
      holdingUnit: "share",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_SHARE",
    });
    const goldFuture = buildInstrumentSemanticKey({
      instrumentKind: "commodity_future",
      venue: "KRX_DERIVATIVES",
      productKey: "gold_future",
      holdingUnit: "contract",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_CONTRACT",
    });
    const convertedReference = buildInstrumentSemanticKey({
      instrumentKind: "reference_price",
      venue: "INTERNATIONAL_GOLD_CONVERSION",
      productKey: "converted_gold_reference",
      holdingUnit: "g",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_G",
    });

    assert.ok(goldSpot);
    assert.equal(new Set([goldSpot, aceGoldEtf, goldFuture, convertedReference]).size, 4);
    assert.equal(
      buildInstrumentSemanticKey({
        ...KRX_GOLD_CLOSE_ONLY_CONTRACT.identity,
        productKey: " ",
      }),
      null,
    );
  });

  it("selects a newer close and retains the last success on failure", () => {
    const current = closeEvidence("2026-07-08", 151_000, "2026-07-08T08:00:00Z");
    const newer = closeEvidence("2026-07-09", 152_000, "2026-07-09T08:00:00Z");

    const selected = resolveKrxGoldCloseEvidence({ current, candidate: newer });
    assert.equal(selected.selection, "candidate");
    assert.equal(selected.reason, "newer_close");
    assert.equal(selected.selected?.priceDate, "2026-07-09");

    const retained = resolveKrxGoldCloseEvidence({
      current: newer,
      candidate: { status: "unavailable", reason: "provider_failure" },
    });
    assert.equal(retained.selection, "current");
    assert.equal(retained.reason, "candidate_unavailable");
    assert.equal(retained.selected?.price, 152_000);
  });

  it("accepts only a later same-date correction and ignores old closes", () => {
    const current = closeEvidence("2026-07-09", 152_000, "2026-07-09T08:00:00Z");
    const corrected = closeEvidence("2026-07-09", 152_100, "2026-07-09T09:00:00Z");
    const correction = resolveKrxGoldCloseEvidence({
      current,
      candidate: corrected,
    });
    assert.equal(correction.selection, "candidate");
    assert.equal(correction.reason, "same_date_correction");

    const earlierFetch = resolveKrxGoldCloseEvidence({
      current: corrected,
      candidate: current,
    });
    assert.equal(earlierFetch.selection, "current");
    assert.equal(earlierFetch.reason, "earlier_correction_ignored");

    const older = resolveKrxGoldCloseEvidence({
      current,
      candidate: closeEvidence(
        "2026-07-08",
        151_000,
        "2026-07-10T08:00:00Z",
      ),
    });
    assert.equal(older.selection, "current");
    assert.equal(older.reason, "older_close_ignored");
  });

  it("does not convert an unchanged close date into zero today movement", () => {
    const baseline = closeEvidence(
      "2026-07-08",
      150_000,
      "2026-07-08T08:00:00Z",
    );
    const sameDate = closeEvidence(
      "2026-07-08",
      150_000,
      "2026-07-09T00:00:00Z",
    );
    const result = classifyKrxGoldCloseMovement({
      quantityG: 8,
      baseline,
      latest: sameDate,
    });

    assert.equal(result.status, "awaiting_new_close");
    assert.equal(result.includeInTodayAggregate, false);
    assert.equal(result.movementKrw, null);
    assert.equal(result.returnPct, null);
  });

  it("calculates close-to-close movement only when a newer close exists", () => {
    const result = classifyKrxGoldCloseMovement({
      quantityG: 8,
      baseline: closeEvidence(
        "2026-07-08",
        150_000,
        "2026-07-08T08:00:00Z",
      ),
      latest: closeEvidence(
        "2026-07-09",
        153_000,
        "2026-07-09T08:00:00Z",
      ),
    });

    assert.equal(result.status, "comparable");
    assert.equal(result.includeInTodayAggregate, true);
    assert.equal(result.unitPriceChangeKrwPerG, 3_000);
    assert.equal(result.movementKrw, 24_000);
    assert.ok(Math.abs(result.returnPct - 2) < 1e-10);
  });

  it("keeps Phase 0 pure and records the current ticker dependencies", () => {
    const source = readFileSync("src/lib/instrument-identity.ts", "utf8");
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const priceSync = readFileSync("src/lib/market-data/price-sync.ts", "utf8");
    const dailySnapshot = readFileSync("src/lib/snapshots/daily.ts", "utf8");
    const gateBUniverse = readFileSync(
      "src/lib/target-policy-holding-universe.ts",
      "utf8",
    );
    const riskInput = readFileSync(
      "src/lib/portfolio-risk-input-sources.ts",
      "utf8",
    );
    const labReadiness = readFileSync(
      "src/lib/investment-lab-counterfactual-readiness.ts",
      "utf8",
    );

    assert.doesNotMatch(
      source,
      /server-only|@\/db|drizzle|fetch\s*\(|livePriceQuotes|assetPriceSnapshots/i,
    );
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
    assert.match(
      schema,
      /assetPriceSnapshots[\s\S]*?ticker: varchar\("ticker"[^\n]*\.notNull\(\)/,
    );
    assert.match(
      schema,
      /livePriceQuotes[\s\S]*?ticker: varchar\("ticker"[^\n]*\.notNull\(\)/,
    );
    assert.match(priceSync, /if \(!ticker\) continue/);
    assert.match(dailySnapshot, /tickerless_current_price_fallback/);
    assert.match(gateBUniverse, /if \(!row\.ticker\) return "tickerless"/);
    assert.match(riskInput, /if \(!ticker\) return "missing_ticker"/);
    assert.match(labReadiness, /ticker_only_instrument_identity/);
  });
});

function closeEvidence(priceDate, price, fetchedAt) {
  return {
    status: "ok",
    source: "krx_open_api_gold_daily",
    quoteKind: "official_close",
    price,
    priceDate,
    fetchedAt,
  };
}
