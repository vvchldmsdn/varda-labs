import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("P1/P2 hardening boundaries", () => {
  it("selects only active, owned, non-cash holdings for shared price sync", () => {
    const source = read("src/lib/market-data/price-sync.ts");
    const route = read("src/app/api/admin/market/prices/sync/route.ts");

    assert.match(source, /innerJoin\(\s*accounts,/);
    assert.match(source, /eq\(accounts\.isActive, true\)/);
    assert.match(source, /ne\(accounts\.accountType, "cash"\)/);
    assert.match(source, /eq\(assets\.accountId, accounts\.id\)/);
    assert.match(
      source,
      /eq\(assets\.canonicalOwnerUserId, accounts\.canonicalOwnerUserId\)/,
    );
    assert.match(source, /isNull\(assets\.archivedAt\)/);
    assert.match(route, /const ACCOUNT_CODE_PATTERN/);
    assert.doesNotMatch(route, /TARGET_ACCOUNTS/);
  });

  it("bounds dashboard events to the selected snapshot date", () => {
    const source = read("src/db/queries/portfolio-dashboard.ts");

    assert.match(
      source,
      /lte\(eventLedgerEntries\.eventDate, snapshotDate\)/,
    );
  });

  it("keeps missing-history repair owner-scoped and provider writes explicit", () => {
    const query = read(
      "src/db/queries/holding-analysis-data-readiness.ts",
    );
    const panel = read("src/components/holding-analysis-data-panel.tsx");
    const investmentLab = read("src/app/investment-lab/page.tsx");
    const simulation = read("src/app/simulation/page.tsx");

    assert.match(query, /^import "server-only";/);
    assert.match(query, /getReadOnlyTenantHoldings\(options\)/);
    assert.match(
      query,
      /getReadOnlyTenantHoldingAnalysisDataReadiness\(\{[\s\S]*tenantContext: options\.tenantContext/,
    );
    assert.match(panel, /HoldingAnalysisDataForm/);
    assert.match(panel, /result\.entries\.filter\(\(entry\) => entry\.readiness\.canPrepare\)/);
    assert.doesNotMatch(panel, /\bfetch\s*\(|\/api\//);
    assert.match(investmentLab, /HoldingAnalysisDataPanel/);
    assert.match(simulation, /HoldingAnalysisDataPanel/);
  });

  it("pins the indexes used by tenant history and normalized price reads", () => {
    const schema = read("src/db/schema.ts");
    const migration = read("drizzle/0039_rapid_amazoness.sql");
    const indexNames = [
      "assets_active_account_instrument_idx",
      "asset_price_snapshots_normalized_instrument_date_idx",
      "event_ledger_entries_owner_account_date_idx",
      "daily_portfolio_snapshots_owner_account_date_idx",
      "daily_position_snapshots_owner_account_date_idx",
      "daily_position_snapshots_owner_asset_date_idx",
    ];

    for (const indexName of indexNames) {
      assert.match(schema, new RegExp(indexName));
      assert.match(migration, new RegExp(indexName));
    }
    assert.equal(migration.match(/CREATE INDEX/g)?.length, indexNames.length);
    assert.doesNotMatch(
      migration,
      /\b(?:insert|update|delete|alter|drop|truncate|grant|revoke)\b/i,
    );
  });

  it("requires explicit tenant selection for operator audits", () => {
    const sources = [
      read("scripts/audit-additional-contribution-ma120-overlay.ts"),
      read("scripts/audit-investment-lab-stress-replay.ts"),
    ].join("\n");

    assert.match(sources, /parseAuditOwnerUserId\(process\.argv\.slice\(2\)\)/);
    assert.match(sources, /guardProductionDatabaseTarget\(process\.env\)/);
    assert.doesNotMatch(
      sources,
      /active-portfolio-owners|getActivePortfolioOwnerUserIds/,
    );
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}
