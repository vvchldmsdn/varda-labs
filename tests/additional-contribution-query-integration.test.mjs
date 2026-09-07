import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { additionalContributionCostBasisKrw } from "../src/lib/additional-contribution-policy-input.ts";
import { buildTargetPolicyHoldingUniverse } from "../src/lib/target-policy-holding-universe.ts";
import { buildTargetPolicyReviewPacket } from "../src/lib/target-policy-review-packet.ts";

const ownerUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "11111111-1111-4111-8111-111111111111";
const tenantContext = Object.freeze({ ownerUserId });
const scope = Object.freeze({ kind: "account", key: `account:${accountId}`, accountId, accountCode: "isa", label: "ISA" });
const now = new Date("2026-09-08T01:00:00Z");
let moduleSequence = 0;

describe("additional contribution query to policy integration", () => {
  it("uses null defaults and honors explicit zero through the actual query and engine", async () => {
    const fixture = makeFixture();
    const query = await loadQuery(fixture);
    const defaults = await run(query, 1000);
    assert.equal(defaults.status, "ready");
    assert.equal(defaults.calculationParameters.trimDriftThresholdPct, 12);
    assert.equal(defaults.calculationParameters.minimumExecutionRatioPct, 85);
    assert.equal(defaults.totalTrimProceedsKrw, 0);

    fixture.settings = [{ minExecutionRatioPct: "0", trimDriftThreshold: "0", useTrendFilter: false }];
    const zero = await run(query, 1000);
    assert.equal(zero.status, "ready");
    assert.equal(zero.calculationParameters.trimDriftThresholdPct, 0);
    assert.equal(zero.totalTrimProceedsKrw, 24475);
    assert.equal(zero.rows[0].allocationKey, `${accountId}:${fixture.model.rows[0].assetId}`);
    assert.ok(fixture.calls.every((call) => call.tenantContext === tenantContext));
  });

  it("requires both tenant and asset MA switches, and keeps gold and bonds exempt", async () => {
    const fixture = makeFixture();
    fixture.model.rows = [
      modelRow("AAA", 250000, 2500, { maAssetClass: "thematic" }),
      modelRow("BBB", 250000, 2500, { maAssetClass: "thematic", maRuleEnabled: false }),
      modelRow("CCC", 250000, 2500, { maAssetClass: "bond" }),
      modelRow("DDD", 250000, 2500, { assetName: "금현물", assetType: "commodity", ticker: null, maAssetClass: null }),
    ];
    fixture.ma = evidence(fixture.model.rows);
    const query = await loadQuery(fixture);
    const off = await run(query, 400000);
    assert.equal(off.status, "ready");
    assert.ok(off.rows.every((row) => row.maEffectiveMultiplier === 1));
    fixture.settings[0].useTrendFilter = true;
    const on = await run(query, 400000);
    assert.equal(on.status, "ready");
    assert.deepEqual(on.rows.map((row) => row.maEffectiveMultiplier), [0.5, 1, 1, 1]);
    assert.equal(on.ma120Evidence.mode, "enabled");
  });

  it("does not turn incomplete fractional cost into an eligible sale", async () => {
    const fixture = makeFixture();
    fixture.settings[0].trimDriftThreshold = "0";
    fixture.model.rows[0].costBasisKrw = additionalContributionCostBasisKrw({ quantity: "2", averageCost: "100000", currency: "KRW", fractionalKrwValue: "350000", fractionalAvgCost: null }, null);
    const result = await run(await loadQuery(fixture), 1000);
    assert.equal(result.status, "ready");
    assert.equal(result.rows[0].costBasisKrw, null);
    assert.equal(result.rows[0].trimReason, "cost_basis_unavailable");
    assert.equal(result.totalTrimProceedsKrw, 0);
  });

  it("retains the policy while reporting an MA evidence read failure", async () => {
    const fixture = makeFixture();
    fixture.settings[0].useTrendFilter = true;
    fixture.maFailure = true;
    const result = await run(await loadQuery(fixture));
    assert.equal(result.status, "ready");
    assert.equal(result.ma120Evidence.status, "read_failed");
    assert.ok(result.rows.every((row) => row.maEffectiveMultiplier === 1));
  });

  it("blocks an incomplete current vector and null valuation instead of silently filling them", async () => {
    const fixture = makeFixture();
    const query = await loadQuery(fixture);
    fixture.model.rows[1].targetWeightBps = 4000;
    const weights = await run(query);
    assert.equal(weights.status, "blocked");
    assert.ok(weights.blockers.includes("target_policy_incomplete"));
    fixture.model.rows[1].targetWeightBps = 5000;
    fixture.model.rows[1].currentValueKrw = null;
    const value = await run(query);
    assert.equal(value.status, "blocked");
    assert.ok(value.blockers.includes("valuation_identity_missing"));
  });

  it("bridges a valid legacy vector to exact account and asset UUIDs including zero targets", async () => {
    const fixture = makeFixture();
    fixture.model.policyValidation.status = "missing";
    fixture.legacy = legacyFixture(fixture.model.rows, [10000, 0]);
    const result = await run(await loadQuery(fixture), 1000);
    assert.equal(result.status, "ready");
    assert.equal(result.source, "legacy_account_policy");
    assert.deepEqual(result.rows.map((row) => row.targetWeightPct), [100, 0]);
    assert.equal(result.rows[1].trimReason, "eligible_zero_target_exit");
    assert.deepEqual(result.rows.map((row) => row.allocationKey), fixture.model.rows.map((row) => `${accountId}:${row.assetId}`));
  });

  it("blocks model omissions and duplicate legacy mappings instead of borrowing an instrument target", async () => {
    for (const mutation of [
      (fixture) => fixture.model.rows.pop(),
      (fixture) => fixture.model.rows.push(modelRow("AAA", 100000, 0, { assetId: "99999999-9999-4999-8999-999999999999" })),
    ]) {
      const fixture = makeFixture();
      fixture.model.policyValidation.status = "missing";
      fixture.legacy = legacyFixture(fixture.model.rows);
      mutation(fixture);
      const result = await run(await loadQuery(fixture));
      assert.equal(result.status, "blocked");
      assert.ok(result.blockers.some((reason) => reason.startsWith("valuation_identity_")));
    }
  });

  it("rejects a foreign account UUID before reading a legacy account-code policy", async () => {
    const fixture = makeFixture();
    fixture.model.policyValidation.status = "missing";
    fixture.model.rows[0].accountId = "99999999-9999-4999-8999-999999999999";
    const result = await run(await loadQuery(fixture));
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["valuation_account_mismatch"]);
    assert.equal(fixture.calls.some((call) => call.kind === "legacy"), false);
  });

  it("projects settings through the supplied tenant transaction without coercing null to zero", async () => {
    let observedOwner;
    let observedSql;
    const settingsModule = await importWithPorts("../src/db/queries/tenant-settings.ts", {
      "@/db/tenant-transaction-context": {
        runTenantReadTransaction: async (owner, build) => {
          observedOwner = owner;
          return Promise.all(build({ query: async (sql) => {
            observedSql = sql;
            return [{ min_execution_ratio_pct: null, trim_drift_threshold: "0", usd_krw_rate: "1500", use_trend_filter: true }];
          } }));
        },
      },
    });
    const rows = await settingsModule.loadLatestTenantPortfolioSettingsRows(tenantContext);
    assert.equal(observedOwner, ownerUserId);
    assert.equal(rows[0].minExecutionRatioPct, null);
    assert.equal(rows[0].trimDriftThreshold, "0");
    assert.equal(rows[0].useTrendFilter, true);
    assert.match(observedSql, /where is_sample = false/);
  });

  it("keeps ambiguous valuation identities unknown in the real model query and scopes both joined owners", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const rows = [modelRow("AAA", 550000, 5000), modelRow("AAA", 450000, 5000, { assetId: "99999999-9999-4999-8999-999999999999" })]
      .map((row) => ({ ...row, quantity: "2", currentPrice: "110000", averageCost: "100000", fractionalKrwValue: "50000", fractionalAvgCost: null }));
    let predicate;
    const builder = { from() { return this; }, innerJoin() { return this; }, where(value) { predicate = value; return this; }, orderBy() { return Promise.resolve(rows); } };
    const modelModule = await importWithPorts("../src/db/queries/portfolio-target-policy.ts", {
      "@/db/client": { db: { select: () => builder } },
      "@/db/queries/portfolio-analysis-scope-targets": { getPortfolioAnalysisScopeTargets: async ({ tenantContext: context }) => {
        assert.equal(context, tenantContext);
        return { includesAllOwnedAccounts: false, wholeAccountIds: [accountId], directAssetIds: [] };
      } },
      "@/db/queries/portfolio-structure": { getReadOnlyTenantPortfolioStructureForScope: async () => ({ holdingRows: rows.map((row) => ({ ...row, name: row.assetName, account: row.accountCode })), usdKrwRate: 1500, dataHealth: {} }) },
      "@/db/queries/tenant-target-policies": { loadCurrentTenantPortfolioTargetPolicy: async ({ tenantContext: context, scopeAccountId }) => {
        assert.equal(context, tenantContext);
        assert.equal(scopeAccountId, accountId);
        return { status: "missing", policy: null };
      } },
    });
    const model = await modelModule.getReadOnlyTenantPortfolioTargetPolicyModel({ scope, serviceDate: "2026-09-07", tenantContext });
    assert.equal(model.rows.length, 2);
    assert.ok(model.rows.every((row) => row.currentValueKrw === null && row.costBasisKrw === null));
    assert.deepEqual(new Set(model.rows.map((row) => row.assetId)), new Set(rows.map((row) => row.assetId)));
    const query = new PgDialect().sqlToQuery(predicate);
    assert.equal(query.params.filter((value) => value === ownerUserId).length, 2);
    assert.ok(query.params.includes(accountId));
  });
});

function run(query, cashAmountKrw = 100000) {
  return query.getReadOnlyTenantAdditionalContributionPreviewForScope({ cashAmountKrw, scope, tenantContext, now });
}

function modelRow(ticker, currentValueKrw, targetWeightBps, overrides = {}) {
  const digit = String(ticker.charCodeAt(0) - 64);
  return { accountCode: "isa", accountId, accountName: "ISA", assetId: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`, assetName: ticker, assetType: "etf", market: "korea", currency: "KRW", ticker, buyability: "buyable", currentValueKrw, targetWeightBps, costBasisKrw: currentValueKrw - 50000, maAssetClass: "broad_index", maRuleEnabled: true, ...overrides };
}

function makeFixture() {
  const rows = [modelRow("AAA", 550000, 5000), modelRow("BBB", 450000, 5000)];
  return {
    calls: [], settings: [{ minExecutionRatioPct: null, trimDriftThreshold: null, useTrendFilter: false }],
    model: { status: "ready", rows, ma120HoldingRows: rows, policyValidation: { status: "available" }, approvedPolicy: { policy: { effectiveServiceDate: "2026-07-01", policyVersion: "fixture-v1" } } },
    ma: evidence(rows), maFailure: false, legacy: legacyFixture(rows),
  };
}

function evidence(rows) {
  return { policyVersion: "fixture", allocationEffect: "bounded_overlay", status: "ready", suppliedHoldingCount: rows.length, evaluatedHoldingCount: rows.length, usableCount: rows.length, unavailableCount: 0, rows: rows.filter((row) => row.ticker).map((row) => ({ instrumentKey: `${row.market}:${row.currency}:${row.ticker}`, status: "below_ma", priceBasis: "private_kis_raw_close", evidence: { availableObservationCount: 120, latestWindowPriceDate: "2026-09-07", ma120: 100, distanceFromMaPct: -4 }, unavailableReason: null })) };
}

function legacyFixture(rows, weights = rows.map((row) => row.targetWeightBps)) {
  const universe = buildTargetPolicyHoldingUniverse({ account: "isa", holdings: rows.map((row) => ({ ...row, name: row.assetName })) });
  const packet = buildTargetPolicyReviewPacket({ account: "isa", policyVersion: "legacy-fixture", effectiveServiceDate: "2026-07-01", currentHoldings: universe.rows, decisions: rows.map((row, index) => ({ market: row.market, currency: row.currency, ticker: row.ticker, targetWeightBps: weights[index], decision: weights[index] === 0 ? "zero_target" : "positive_target", exclusionReason: null })) });
  assert.equal(packet.status, "reviewable");
  return {
    universe,
    policy: { status: "available", policy: { approvalState: "approved", policyId: packet.policy.policyId, account: "isa", policyVersion: "legacy-fixture", effectiveServiceDate: "2026-07-01", universeHash: universe.universeHash, vectorHash: packet.vectorHash, vector: packet.canonicalVector } },
    structure: { selectedAccount: "isa", holdingRows: rows.map((row) => ({ ...row, account: "isa", name: row.assetName })), totalValueKrw: rows.reduce((sum, row) => sum + row.currentValueKrw, 0) },
  };
}

async function loadQuery(fixture) {
  const read = (kind, value) => async (args) => { fixture.calls.push({ kind, ...args }); return value(); };
  return importWithPorts("../src/db/queries/additional-contribution.ts", {
    "@/db/queries/portfolio-target-policy": { getReadOnlyTenantPortfolioTargetPolicyModel: read("model", () => fixture.model) },
    "@/db/queries/tenant-settings": { loadLatestTenantPortfolioSettingsRows: async (context) => { fixture.calls.push({ kind: "settings", tenantContext: context }); return fixture.settings; } },
    "@/db/queries/additional-contribution-ma120": { getReadOnlyTenantAdditionalContributionMa120Evidence: async () => { if (fixture.maFailure) throw new Error("fixture unavailable"); return fixture.ma; } },
    "@/db/queries/portfolio-structure": { getReadOnlyTenantPortfolioStructure: read("structure", () => fixture.legacy.structure) },
    "@/db/queries/target-policy": { getReadOnlyTenantApprovedTargetPolicy: read("legacy", () => fixture.legacy.policy) },
    "@/db/queries/target-policy-holding-universe": { getReadOnlyTenantTargetPolicyHoldingUniverse: read("universe", () => fixture.legacy.universe) },
  });
}

// Exercise production orchestration and calculation; replace only I/O modules.
// Each import owns its ports and removes the hook before the test executes.
async function importWithPorts(path, ports) {
  const registryKey = `__vardaContributionTestPorts${++moduleSequence}`;
  globalThis[registryKey] = ports;
  const stubUrls = new Map(Object.entries(ports).map(([specifier, exports]) => [specifier, `data:text/javascript,${encodeURIComponent(Object.keys(exports).map((name) => `export const ${name} = globalThis[${JSON.stringify(registryKey)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`).join("\n"))}`]));
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (stubUrls.has(specifier)) return { url: stubUrls.get(specifier), shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  } });
  try {
    const url = new URL(path, import.meta.url);
    url.searchParams.set("query-integration", String(moduleSequence));
    return await import(url.href);
  } finally {
    hooks.deregister();
    delete globalThis[registryKey];
  }
}
