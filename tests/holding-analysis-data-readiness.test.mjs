import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  HOLDING_ANALYSIS_DATA_READINESS_POLICY,
  buildHoldingAnalysisDataReadiness,
  evaluateHoldingAnalysisDataCooldown,
  parseHoldingAnalysisDataPreparationInput,
} from "../src/lib/holding-analysis-data-readiness.ts";
import { shiftRiskDate } from "../src/lib/portfolio-risk-calendar.ts";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const HOLDING_ID = "22222222-2222-4222-8222-222222222222";
const SERVICE_DATE = "2026-08-21";
const writerSource = readFileSync(
  new URL(
    "../src/lib/holding-analysis-data-preparation-write.ts",
    import.meta.url,
  ),
  "utf8",
);
const querySource = readFileSync(
  new URL(
    "../src/db/queries/holding-analysis-data-readiness.ts",
    import.meta.url,
  ),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/app/portfolio/holdings/page.tsx", import.meta.url),
  "utf8",
);
const onboardingWriterSource = readFileSync(
  new URL("../src/lib/holding-onboarding-write.ts", import.meta.url),
  "utf8",
);

describe("holding analysis data readiness", () => {
  it("marks 130 fresh qualified closes ready for simulation and trend analysis", () => {
    const result = readiness({ priceRows: priceRows(130) });

    assert.equal(result.state, "ready");
    assert.equal(result.reason, "analysis_inputs_ready");
    assert.equal(result.observationCount, 130);
    assert.equal(result.simulationReady, true);
    assert.equal(result.trendReady, true);
    assert.equal(result.freshnessDays, 0);
    assert.equal(result.canPrepare, false);
  });

  it("requires matching USD/KRW evidence before a US holding is ready", () => {
    const candidate = holding({
      name: "Invesco QQQ Trust",
      ticker: "QQQ",
      market: "us",
      currency: "USD",
    });
    const prices = priceRows(130, candidate);
    const withoutFx = readiness({ holding: candidate, priceRows: prices });
    const withFx = readiness({
      holding: candidate,
      priceRows: prices,
      fxRows: prices.map((row, index) => ({
        rateDate: row.priceDate,
        usdKrw: 1_500 + index / 100,
        status: "ok",
      })),
    });

    assert.equal(withoutFx.state, "limited");
    assert.equal(withoutFx.reason, "simulation_history_incomplete");
    assert.equal(withoutFx.trendReady, true);
    assert.equal(withFx.state, "ready");
    assert.equal(withFx.reason, "analysis_inputs_ready");
    assert.equal(withFx.simulationReady, true);
  });

  it("keeps a 95-row history usable for simulation while trend data is incomplete", () => {
    const result = readiness({ priceRows: priceRows(95) });

    assert.equal(result.state, "limited");
    assert.equal(result.reason, "trend_history_incomplete");
    assert.equal(result.simulationReady, true);
    assert.equal(result.trendReady, false);
    assert.equal(result.canPrepare, true);
  });

  it("distinguishes missing cache data from a blocked owner boundary", () => {
    const missing = readiness({ priceRows: [] });
    const blocked = readiness({
      priceRows: priceRows(130),
      activeOwnerUserIds: [OWNER_ID, "33333333-3333-4333-8333-333333333333"],
    });

    assert.equal(missing.state, "missing");
    assert.equal(missing.reason, "stored_history_missing");
    assert.equal(missing.canPrepare, true);
    assert.equal(blocked.state, "blocked");
    assert.equal(blocked.reason, "private_owner_scope_not_established");
    assert.equal(blocked.canPrepare, false);
  });

  it("keeps physical gold manual and managed sleeves outside provider preparation", () => {
    const gold = readiness({
      holding: holding({ assetType: "commodity", ticker: null }),
      priceRows: [],
    });
    const managed = readiness({
      holding: holding({ assetType: "managed_product", ticker: "FOUNT" }),
      priceRows: [],
    });

    assert.equal(gold.state, "unsupported");
    assert.equal(gold.reason, "manual_history_required");
    assert.equal(managed.state, "unsupported");
    assert.equal(managed.reason, "managed_sleeve_excluded");
  });

  it("uses the exact reviewed Fount metadata without inferring from its name alone", () => {
    const fount = readiness({
      holding: holding({
        accountCode: "irp",
        name: "Fount 일임서비스",
        ticker: null,
        assetType: "etf",
      }),
      priceRows: [],
    });
    const sameNameDifferentAccount = readiness({
      holding: holding({
        accountCode: "brokerage",
        name: "Fount 일임서비스",
        ticker: null,
        assetType: "etf",
      }),
      priceRows: [],
    });

    assert.equal(fount.state, "unsupported");
    assert.equal(fount.reason, "managed_sleeve_excluded");
    assert.equal(sameNameDifferentAccount.state, "unsupported");
    assert.equal(
      sameNameDifferentAccount.reason,
      "instrument_identity_unresolved",
    );
  });

  it("returns cooldown evidence immediately without waiting", () => {
    const now = new Date("2026-08-21T00:00:00.000Z");
    const blocked = evaluateHoldingAnalysisDataCooldown({
      now,
      lastActivityAt: new Date("2026-08-20T23:59:30.000Z"),
      cooldownSeconds: 90,
    });
    const ready = evaluateHoldingAnalysisDataCooldown({
      now,
      lastActivityAt: new Date("2026-08-20T23:58:00.000Z"),
      cooldownSeconds: 90,
    });

    assert.deepEqual(blocked, { ready: false, retryAfterSeconds: 60 });
    assert.deepEqual(ready, { ready: true, retryAfterSeconds: 0 });
  });

  it("accepts only a canonical holding id from the browser", () => {
    const valid = new FormData();
    valid.set("holdingId", HOLDING_ID);
    valid.set("ticker", "UNTRUSTED");
    const invalid = new FormData();
    invalid.set("holdingId", "not-a-uuid");

    assert.deepEqual(parseHoldingAnalysisDataPreparationInput(valid), {
      ok: true,
      holdingId: HOLDING_ID,
    });
    assert.equal(parseHoldingAnalysisDataPreparationInput(invalid).ok, false);
  });

  it("keeps owner identity and provider authority on the server boundary", () => {
    assert.match(querySource, /runTenantReadTransaction/);
    assert.match(querySource, /where asset\.id = \$1::uuid/);
    assert.match(writerSource, /getReadOnlyTenantHoldingAnalysisPreparationTarget/);
    assert.match(writerSource, /ticker = target\.ticker/);
    assert.match(writerSource, /accounts: \[\]/);
    assert.match(writerSource, /assetIds: \[\]/);
    assert.match(writerSource, /managed_sleeve_excluded/);
    assert.doesNotMatch(writerSource, /setTimeout|Start-Sleep|\bretry\b/i);
    assert.doesNotMatch(onboardingWriterSource, /\bfetch\s*\(/);
    assert.doesNotMatch(pageSource, /createKisMarketDataProvider/);
    assert.equal(
      HOLDING_ANALYSIS_DATA_READINESS_POLICY.providerCallsDuringRead,
      "forbidden",
    );
  });
});

function readiness({
  holding: candidate = holding(),
  priceRows,
  activeOwnerUserIds = [OWNER_ID],
  fxRows = [],
}) {
  return buildHoldingAnalysisDataReadiness({
    holding: candidate,
    serviceDate: SERVICE_DATE,
    requestedOwnerUserId: OWNER_ID,
    activeOwnerUserIds,
    priceRows,
    fxRows,
  });
}

function holding(overrides = {}) {
  return {
    holdingId: HOLDING_ID,
    accountCode: "brokerage",
    name: "KODEX 200",
    ticker: "069500",
    assetType: "etf",
    market: "korea",
    currency: "KRW",
    ...overrides,
  };
}

function priceRows(count, candidate = holding()) {
  const latestPriceDate = shiftRiskDate(SERVICE_DATE, -1);
  return Array.from({ length: count }, (_, index) => {
    const priceDate = shiftRiskDate(latestPriceDate, index - count + 1);
    return {
      market: candidate.market,
      currency: candidate.currency,
      ticker: candidate.ticker,
      priceDate,
      closePrice: 100_000 + index,
      source: "kis_history",
      providerSymbol: candidate.ticker,
      providerExchange: candidate.market === "us" ? "NAS" : "KRX",
      fetchedAt: `${priceDate}T12:00:00.000Z`,
    };
  });
}
