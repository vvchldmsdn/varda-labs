import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const SAMPLE_LIMIT = 10;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const [
    rowCounts,
    accounts,
    assets,
    assetGroups,
    assetGroupMembers,
    eventLedger,
    dailyPositions,
    dailyPortfolios,
    generatedSnapshots,
  ] = await Promise.all([
    getRowCounts(),
    getAccountAudit(),
    getAssetAudit(),
    getAssetGroupAudit(),
    getAssetGroupMemberAudit(),
    getEventLedgerAudit(),
    getDailyPositionAudit(),
    getDailyPortfolioAudit(),
    getGeneratedSnapshotAudit(),
  ]);

  const checks = [
    ...accounts.checks,
    ...assets.checks,
    ...assetGroups.checks,
    ...assetGroupMembers.checks,
    ...eventLedger.checks,
    ...dailyPositions.checks,
    ...dailyPortfolios.checks,
    ...generatedSnapshots.checks,
  ];
  const failedChecks = checks.filter((check) => !check.ok);
  const failedErrorChecks = failedChecks.filter(
    (check) => check.severity === "error",
  );

  const result = {
    audit: "data_integrity",
    readOnly: true,
    generatedAt: new Date().toISOString(),
    ok: failedErrorChecks.length === 0,
    summary: {
      checkCount: checks.length,
      failedCheckCount: failedChecks.length,
      failedErrorCheckCount: failedErrorChecks.length,
      failedChecks: failedChecks.map(({ id, severity, message }) => ({
        id,
        severity,
        message,
      })),
    },
    rowCounts,
    accounts: accounts.data,
    assets: assets.data,
    assetGroups: assetGroups.data,
    assetGroupMembers: assetGroupMembers.data,
    eventLedger: eventLedger.data,
    dailyPositionSnapshots: dailyPositions.data,
    dailyPortfolioSnapshots: dailyPortfolios.data,
    generatedSnapshots: generatedSnapshots.data,
    checks,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function getRowCounts() {
  const rows = await sql.query(`
    select *
    from (
      values
        ('accounts', (select count(*)::int from accounts)),
        ('assets', (select count(*)::int from assets)),
        ('asset_groups', (select count(*)::int from asset_groups)),
        ('asset_group_members', (select count(*)::int from asset_group_members)),
        ('asset_price_snapshots', (select count(*)::int from asset_price_snapshots)),
        ('event_ledger_entries', (select count(*)::int from event_ledger_entries)),
        ('daily_portfolio_snapshots', (select count(*)::int from daily_portfolio_snapshots)),
        ('daily_position_snapshots', (select count(*)::int from daily_position_snapshots)),
        ('etf_masters', (select count(*)::int from etf_masters)),
        ('etf_holdings', (select count(*)::int from etf_holdings)),
        ('fx_rates', (select count(*)::int from fx_rates)),
        ('settings', (select count(*)::int from settings)),
        ('market_data_sync_runs', (select count(*)::int from market_data_sync_runs))
    ) as counts(table_name, row_count)
    order by table_name
  `);

  return Object.fromEntries(
    rows.map((row) => [row.table_name, Number(row.row_count ?? 0)]),
  );
}

async function getAccountAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where is_active)::int as active,
      count(*) filter (where not is_active)::int as inactive,
      count(distinct code)::int as distinct_codes
    from accounts
  `);
  const duplicateCodes = await sql.query(`
    select code, count(*)::int as rows
    from accounts
    group by code
    having count(*) > 1
    order by rows desc, code asc
    limit ${SAMPLE_LIMIT}
  `);

  return {
    data: {
      total: toNumber(summary.total),
      active: toNumber(summary.active),
      inactive: toNumber(summary.inactive),
      distinctCodes: toNumber(summary.distinct_codes),
      duplicateCodes,
    },
    checks: [
      check(
        "accounts.duplicate_codes",
        duplicateCodes.length === 0,
        "error",
        `${duplicateCodes.length} duplicate account code groups`,
      ),
    ],
  };
}

async function getAssetAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where legacy_base44_id is not null)::int as legacy_id_rows,
      count(*) filter (where account_id is null)::int as null_account_id_rows,
      count(*) filter (where group_id is null)::int as null_group_id_rows,
      count(*) filter (where ticker is null or trim(ticker) = '')::int as tickerless_rows
    from assets
  `);
  const accountIdOrphans = await sql.query(`
    select count(*)::int as rows
    from assets a
    left join accounts acct on acct.id = a.account_id
    where a.account_id is not null and acct.id is null
  `);
  const accountStringMismatches = await sql.query(`
    select a.account, count(*)::int as rows
    from assets a
    left join accounts acct on acct.code = a.account
    where acct.id is null
    group by a.account
    order by rows desc, a.account asc
  `);
  const groupIdOrphans = await sql.query(`
    select count(*)::int as rows
    from assets a
    left join asset_groups g on g.id = a.group_id
    where a.group_id is not null and g.id is null
  `);
  const legacyDuplicates = await duplicateLegacyIds("assets");

  const accountIdOrphanCount = firstCount(accountIdOrphans);
  const groupIdOrphanCount = firstCount(groupIdOrphans);

  return {
    data: {
      total: toNumber(summary.total),
      legacyIdRows: toNumber(summary.legacy_id_rows),
      nullAccountIdRows: toNumber(summary.null_account_id_rows),
      nullGroupIdRows: toNumber(summary.null_group_id_rows),
      tickerlessRows: toNumber(summary.tickerless_rows),
      accountIdOrphanCount,
      accountStringMismatches,
      groupIdOrphanCount,
      duplicateLegacyBase44Ids: legacyDuplicates,
    },
    checks: [
      check(
        "assets.account_id_orphans",
        accountIdOrphanCount === 0,
        "error",
        `${accountIdOrphanCount} assets reference missing accounts`,
      ),
      check(
        "assets.account_code_mismatches",
        accountStringMismatches.length === 0,
        "error",
        `${accountStringMismatches.length} asset account strings do not match accounts.code`,
      ),
      check(
        "assets.group_id_orphans",
        groupIdOrphanCount === 0,
        "error",
        `${groupIdOrphanCount} assets reference missing asset groups`,
      ),
      check(
        "assets.duplicate_legacy_base44_id",
        legacyDuplicates.length === 0,
        "error",
        `${legacyDuplicates.length} duplicate legacy_base44_id groups`,
      ),
    ],
  };
}

async function getAssetGroupAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where legacy_base44_id is not null)::int as legacy_id_rows,
      count(*) filter (where is_active)::int as active,
      count(*) filter (where not is_active)::int as inactive
    from asset_groups
  `);
  const legacyDuplicates = await duplicateLegacyIds("asset_groups");

  return {
    data: {
      total: toNumber(summary.total),
      legacyIdRows: toNumber(summary.legacy_id_rows),
      active: toNumber(summary.active),
      inactive: toNumber(summary.inactive),
      duplicateLegacyBase44Ids: legacyDuplicates,
    },
    checks: [
      check(
        "asset_groups.duplicate_legacy_base44_id",
        legacyDuplicates.length === 0,
        "error",
        `${legacyDuplicates.length} duplicate legacy_base44_id groups`,
      ),
    ],
  };
}

async function getAssetGroupMemberAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where is_active)::int as active,
      count(*) filter (where not is_active)::int as inactive
    from asset_group_members
  `);
  const assetOrphans = await sql.query(`
    select count(*)::int as rows
    from asset_group_members m
    left join assets a on a.id = m.asset_id
    where a.id is null
  `);
  const groupOrphans = await sql.query(`
    select count(*)::int as rows
    from asset_group_members m
    left join asset_groups g on g.id = m.group_id
    where g.id is null
  `);
  const duplicateMemberships = await sql.query(`
    select group_id::text as group_id, asset_id::text as asset_id, count(*)::int as rows
    from asset_group_members
    group by group_id, asset_id
    having count(*) > 1
    order by rows desc, group_id asc, asset_id asc
    limit ${SAMPLE_LIMIT}
  `);
  const assetOrphanCount = firstCount(assetOrphans);
  const groupOrphanCount = firstCount(groupOrphans);

  return {
    data: {
      total: toNumber(summary.total),
      active: toNumber(summary.active),
      inactive: toNumber(summary.inactive),
      assetOrphanCount,
      groupOrphanCount,
      duplicateMemberships,
    },
    checks: [
      check(
        "asset_group_members.asset_id_orphans",
        assetOrphanCount === 0,
        "error",
        `${assetOrphanCount} group members reference missing assets`,
      ),
      check(
        "asset_group_members.group_id_orphans",
        groupOrphanCount === 0,
        "error",
        `${groupOrphanCount} group members reference missing groups`,
      ),
      check(
        "asset_group_members.duplicate_memberships",
        duplicateMemberships.length === 0,
        "error",
        `${duplicateMemberships.length} duplicate group/asset memberships`,
      ),
    ],
  };
}

async function getEventLedgerAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where legacy_base44_id is not null)::int as legacy_id_rows,
      count(*) filter (where account_id is null)::int as null_account_id_rows,
      count(*) filter (where asset_id is null)::int as null_asset_id_rows,
      count(*) filter (where group_id is null)::int as null_group_id_rows,
      count(*) filter (where corrects_event_id is not null)::int as correction_rows
    from event_ledger_entries
  `);
  const accountIdOrphans = await countUuidOrphans(
    "event_ledger_entries",
    "account_id",
    "accounts",
  );
  const assetIdOrphans = await countUuidOrphans(
    "event_ledger_entries",
    "asset_id",
    "assets",
  );
  const groupIdOrphans = await countUuidOrphans(
    "event_ledger_entries",
    "group_id",
    "asset_groups",
  );
  const correctionOrphans = await countUuidOrphans(
    "event_ledger_entries",
    "corrects_event_id",
    "event_ledger_entries",
  );
  const accountStringMismatches = await sql.query(`
    select e.account, count(*)::int as rows
    from event_ledger_entries e
    left join accounts acct on acct.code = e.account
    where e.account is not null and acct.id is null
    group by e.account
    order by rows desc, e.account asc
    limit ${SAMPLE_LIMIT}
  `);

  return {
    data: {
      total: toNumber(summary.total),
      legacyIdRows: toNumber(summary.legacy_id_rows),
      nullAccountIdRows: toNumber(summary.null_account_id_rows),
      nullAssetIdRows: toNumber(summary.null_asset_id_rows),
      nullGroupIdRows: toNumber(summary.null_group_id_rows),
      correctionRows: toNumber(summary.correction_rows),
      accountIdOrphanCount: accountIdOrphans,
      assetIdOrphanCount: assetIdOrphans,
      groupIdOrphanCount: groupIdOrphans,
      correctionOrphanCount: correctionOrphans,
      accountStringMismatches,
    },
    checks: [
      check(
        "event_ledger_entries.account_id_orphans",
        accountIdOrphans === 0,
        "error",
        `${accountIdOrphans} event rows reference missing accounts`,
      ),
      check(
        "event_ledger_entries.asset_id_orphans",
        assetIdOrphans === 0,
        "error",
        `${assetIdOrphans} event rows reference missing assets`,
      ),
      check(
        "event_ledger_entries.group_id_orphans",
        groupIdOrphans === 0,
        "error",
        `${groupIdOrphans} event rows reference missing groups`,
      ),
      check(
        "event_ledger_entries.corrects_event_id_orphans",
        correctionOrphans === 0,
        "error",
        `${correctionOrphans} correction rows reference missing events`,
      ),
      check(
        "event_ledger_entries.account_code_mismatches",
        accountStringMismatches.length === 0,
        "error",
        `${accountStringMismatches.length} event account strings do not match accounts.code`,
      ),
    ],
  };
}

async function getDailyPositionAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where legacy_base44_id is not null)::int as imported_rows,
      count(*) filter (where legacy_base44_id is null)::int as generated_rows,
      count(*) filter (where asset_id is null)::int as null_asset_id_rows,
      count(*) filter (where account_id is null)::int as null_account_id_rows,
      count(distinct snapshot_date)::int as snapshot_dates
    from daily_position_snapshots
  `);
  const sourceDistribution = await sourceDistributionFor("daily_position_snapshots");
  const assetIdOrphans = await countUuidOrphans(
    "daily_position_snapshots",
    "asset_id",
    "assets",
  );
  const accountIdOrphans = await countUuidOrphans(
    "daily_position_snapshots",
    "account_id",
    "accounts",
  );
  const legacyAssetUnmatched = await sql.query(`
    select legacy_asset_id, count(*)::int as rows
    from daily_position_snapshots p
    left join assets a on a.legacy_base44_id = p.legacy_asset_id
    where p.legacy_asset_id is not null and a.id is null
    group by legacy_asset_id
    order by rows desc, legacy_asset_id asc
    limit ${SAMPLE_LIMIT}
  `);
  const accountStringMismatches = await sql.query(`
    select p.account, count(*)::int as rows
    from daily_position_snapshots p
    left join accounts acct on acct.code = p.account
    where acct.id is null
    group by p.account
    order by rows desc, p.account asc
    limit ${SAMPLE_LIMIT}
  `);
  const importedDuplicates = await sql.query(`
    select snapshot_date::text as snapshot_date, account, asset_id::text as asset_id, source, count(*)::int as rows
    from daily_position_snapshots
    where asset_id is not null
    group by snapshot_date, account, asset_id, source
    having count(*) > 1
    order by snapshot_date desc, rows desc
    limit ${SAMPLE_LIMIT}
  `);

  return {
    data: {
      total: toNumber(summary.total),
      importedRows: toNumber(summary.imported_rows),
      generatedRows: toNumber(summary.generated_rows),
      nullAssetIdRows: toNumber(summary.null_asset_id_rows),
      nullAccountIdRows: toNumber(summary.null_account_id_rows),
      snapshotDates: toNumber(summary.snapshot_dates),
      sourceDistribution,
      assetIdOrphanCount: assetIdOrphans,
      accountIdOrphanCount: accountIdOrphans,
      legacyAssetUnmatched,
      accountStringMismatches,
      duplicateCurrentAssetSnapshots: importedDuplicates,
    },
    checks: [
      check(
        "daily_position_snapshots.asset_id_orphans",
        assetIdOrphans === 0,
        "error",
        `${assetIdOrphans} position snapshots reference missing assets`,
      ),
      check(
        "daily_position_snapshots.account_id_orphans",
        accountIdOrphans === 0,
        "error",
        `${accountIdOrphans} position snapshots reference missing accounts`,
      ),
      check(
        "daily_position_snapshots.account_code_mismatches",
        accountStringMismatches.length === 0,
        "error",
        `${accountStringMismatches.length} position account strings do not match accounts.code`,
      ),
      check(
        "daily_position_snapshots.duplicate_current_asset_snapshots",
        importedDuplicates.length === 0,
        "error",
        `${importedDuplicates.length} duplicate snapshot/account/asset/source groups`,
      ),
      check(
        "daily_position_snapshots.unmatched_legacy_asset_ids",
        legacyAssetUnmatched.length === 0,
        "info",
        `${legacyAssetUnmatched.length} legacy asset id groups have no current asset match`,
      ),
    ],
  };
}

async function getDailyPortfolioAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where legacy_base44_id is not null)::int as imported_rows,
      count(*) filter (where legacy_base44_id is null)::int as generated_rows,
      count(*) filter (where account_id is null)::int as null_account_id_rows,
      count(distinct snapshot_date)::int as snapshot_dates
    from daily_portfolio_snapshots
  `);
  const sourceDistribution = await sourceDistributionFor(
    "daily_portfolio_snapshots",
  );
  const accountIdOrphans = await countUuidOrphans(
    "daily_portfolio_snapshots",
    "account_id",
    "accounts",
  );
  const accountStringMismatches = await sql.query(`
    select p.account, count(*)::int as rows
    from daily_portfolio_snapshots p
    left join accounts acct on acct.code = p.account
    where p.account <> 'all' and acct.id is null
    group by p.account
    order by rows desc, p.account asc
    limit ${SAMPLE_LIMIT}
  `);
  const duplicateSnapshots = await sql.query(`
    select snapshot_date::text as snapshot_date, account, source, count(*)::int as rows
    from daily_portfolio_snapshots
    group by snapshot_date, account, source
    having count(*) > 1
    order by snapshot_date desc, rows desc
    limit ${SAMPLE_LIMIT}
  `);

  return {
    data: {
      total: toNumber(summary.total),
      importedRows: toNumber(summary.imported_rows),
      generatedRows: toNumber(summary.generated_rows),
      nullAccountIdRows: toNumber(summary.null_account_id_rows),
      snapshotDates: toNumber(summary.snapshot_dates),
      sourceDistribution,
      accountIdOrphanCount: accountIdOrphans,
      accountStringMismatches,
      duplicateSnapshots,
    },
    checks: [
      check(
        "daily_portfolio_snapshots.account_id_orphans",
        accountIdOrphans === 0,
        "error",
        `${accountIdOrphans} portfolio snapshots reference missing accounts`,
      ),
      check(
        "daily_portfolio_snapshots.account_code_mismatches",
        accountStringMismatches.length === 0,
        "error",
        `${accountStringMismatches.length} portfolio account strings do not match accounts.code`,
      ),
      check(
        "daily_portfolio_snapshots.duplicates",
        duplicateSnapshots.length === 0,
        "error",
        `${duplicateSnapshots.length} duplicate snapshot/account/source groups`,
      ),
    ],
  };
}

async function getGeneratedSnapshotAudit() {
  const latestGeneratedPortfolio = await sql.query(`
    select snapshot_date::text as snapshot_date, account, source, count(*)::int as rows
    from daily_portfolio_snapshots
    where source = 'varda_manual_daily_snapshot'
    group by snapshot_date, account, source
    order by snapshot_date desc, account asc
    limit 20
  `);
  const latestGeneratedPositions = await sql.query(`
    select snapshot_date::text as snapshot_date, account, source, count(*)::int as rows
    from daily_position_snapshots
    where source = 'varda_manual_daily_snapshot'
    group by snapshot_date, account, source
    order by snapshot_date desc, account asc
    limit 20
  `);

  return {
    data: {
      latestGeneratedPortfolio,
      latestGeneratedPositions,
    },
    checks: [],
  };
}

async function duplicateLegacyIds(tableName) {
  return sql.query(`
    select legacy_base44_id, count(*)::int as rows
    from ${tableName}
    where legacy_base44_id is not null
    group by legacy_base44_id
    having count(*) > 1
    order by rows desc, legacy_base44_id asc
    limit ${SAMPLE_LIMIT}
  `);
}

async function countUuidOrphans(sourceTable, sourceColumn, targetTable) {
  const rows = await sql.query(`
    select count(*)::int as rows
    from ${sourceTable} source
    left join ${targetTable} target on target.id = source.${sourceColumn}
    where source.${sourceColumn} is not null and target.id is null
  `);
  return firstCount(rows);
}

async function sourceDistributionFor(tableName) {
  return sql.query(`
    select coalesce(source, '(null)') as source, count(*)::int as rows
    from ${tableName}
    group by coalesce(source, '(null)')
    order by rows desc, source asc
  `);
}

function check(id, ok, severity, message) {
  return { id, ok, severity, message };
}

function firstCount(rows) {
  return toNumber(rows[0]?.rows);
}

function toNumber(value) {
  return Number(value ?? 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
