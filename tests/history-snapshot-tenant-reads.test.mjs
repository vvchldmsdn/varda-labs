import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("History snapshot tenant reads", () => {
  it("routes every History snapshot shape through tenant-role transactions", () => {
    const source = read("src/db/queries/tenant-history-snapshots.ts");

    assert.match(source, /runTenantReadTransaction/);
    assert.match(source, /tenantContext\.ownerUserId/g);
    assert.match(source, /from public\.daily_portfolio_snapshots as snapshot/);
    assert.match(source, /from public\.daily_position_snapshots as snapshot/g);
    assert.match(source, /inner join public\.accounts as account/g);
    assert.doesNotMatch(source, /from "@\/db\/client"/);
    assert.doesNotMatch(source, /canonical_owner_user_id/);
  });

  it("preserves exact account, date, source, and bounded detail filters", () => {
    const source = read("src/db/queries/tenant-history-snapshots.ts");

    assert.match(source, /account\.id = \$1::uuid/);
    assert.match(source, /account\.code = \$2::text/);
    assert.match(source, /snapshot\.snapshot_date = \$3::date/g);
    assert.match(source, /snapshot\.source = \$4::text/g);
    assert.match(source, /limit \$5::integer/g);
    assert.match(source, /snapshot\.is_sample = false/g);
  });

  it("keeps portfolio-group candidate selection bounded by owned membership ids", () => {
    const source = read("src/db/queries/tenant-history-snapshots.ts");

    assert.match(source, /snapshot\.snapshot_date >= \$1::date/);
    assert.match(source, /snapshot\.account_id = any\(\$2::uuid\[\]\)/);
    assert.match(source, /snapshot\.asset_id = any\(\$3::uuid\[\]\)/);
    assert.match(
      source,
      /if \(accountIds\.length === 0 && assetIds\.length === 0\) return \[\]/,
    );
  });

  it("prevents History from falling back to direct privileged snapshot reads", () => {
    const historySource = read("src/db/queries/history-balance.ts");

    assert.match(historySource, /tenant-history-snapshots/);
    assert.match(historySource, /loadTenantHistoryPortfolioRows/);
    assert.match(historySource, /loadTenantHistoryPositionDetailRows/);
    assert.match(historySource, /loadTenantHistoryPositionComparisonRows/);
    assert.match(historySource, /loadTenantHistoryGroupPositionRows/);
    assert.doesNotMatch(historySource, /dailyPortfolioSnapshots/);
    assert.doesNotMatch(historySource, /dailyPositionSnapshots/);
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}
