import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const PASSWORD =
  process.env.VARDA_APP_PASSWORD?.trim() ||
  process.env.APP_ACCESS_PASSWORD?.trim();
const USERNAME = process.env.VARDA_APP_USER?.trim() || "varda";
const LEAK_PATTERN =
  /legacyBase44Id|holdingId|api[_-]?key|authorization|password|secret|token|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i;

const scenarios = [
  {
    label: "all_lanes",
    path: "/history",
    expectedSections: ["balance", "portfolio", "events"],
    absentSections: [],
    expectedCharts: ["balance", "portfolio"],
    absentCharts: [],
    expectedText: [
      "히스토리",
      "잔액 기준일",
      "스냅샷 저장일",
      "저장값",
      "표시용 합산",
      "저장 이벤트",
    ],
    minimumOverflowContainers: 2,
    expectedEvent: {
      allowedStatuses: ["blocked"],
      eventCount: 0,
      tradeCount: 0,
      lifecycleCount: 0,
      legacyOnlyCount: 0,
      correctionCount: 0,
    },
  },
  {
    label: "brokerage_balance",
    path: "/history?account=brokerage&lane=balance",
    expectedSections: ["balance"],
    absentSections: ["portfolio", "events"],
    expectedCharts: ["balance"],
    absentCharts: ["portfolio"],
    expectedText: ["증권", "잔액 기준일"],
    minimumOverflowContainers: 1,
  },
  {
    label: "isa_portfolio",
    path: "/history?account=isa&lane=portfolio",
    expectedSections: ["portfolio"],
    absentSections: ["balance", "events"],
    expectedCharts: ["portfolio"],
    absentCharts: ["balance"],
    expectedText: ["ISA", "스냅샷 저장일", "저장값"],
    minimumOverflowContainers: 1,
  },
  {
    label: "all_portfolio_derived",
    path: "/history?account=all&lane=portfolio",
    expectedSections: ["portfolio"],
    absentSections: ["balance", "events"],
    expectedCharts: ["portfolio"],
    absentCharts: ["balance"],
    expectedText: ["표시용 합산", 'data-history-row-kind="derived"'],
    minimumOverflowContainers: 1,
  },
];

if (!PASSWORD) throw new Error("Dashboard access password is not configured");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;

async function main() {
  const countsBefore = await readCounts();
  const [detailCandidates, brokerageEventStats, comparisonCandidate] =
    await Promise.all([
    readDetailCandidates(),
    readEventStats("brokerage"),
      readComparisonCandidate(),
    ]);
  const routeScenarios = [
    ...scenarios,
    eventScenario(brokerageEventStats),
    comparisonScenario(comparisonCandidate),
    detailScenario("generated_position_detail", detailCandidates.generated, {
      allowedStatuses: ["ready"],
      allowedReconciliation: ["matched"],
      expectedText: ["저장 자산 참조"],
    }),
    detailScenario("legacy_position_detail", detailCandidates.legacy, {
      allowedStatuses: ["ready", "partial"],
      allowedReconciliation: ["matched", "mismatch", "not_comparable"],
      expectedText: ["레거시 전용"],
    }),
  ];
  const unauthorizedHistory = await request("/history");
  const unauthorizedDashboard = await request("/");
  assert.equal(
    unauthorizedHistory.status,
    401,
    "no-auth history request must return 401",
  );
  assert.equal(
    unauthorizedDashboard.status,
    401,
    "no-auth dashboard request must return 401",
  );

  const dashboard = await request("/", true);
  assert.equal(dashboard.status, 200, "authenticated dashboard must return 200");
  assert.match(dashboard.body, /href="\/portfolio\/risk"/);
  assert.match(dashboard.body, /href="\/history"/);
  assert.match(dashboard.body, /히스토리/);
  assert.ok(
    dashboard.body.indexOf('href="/portfolio/risk"') <
      dashboard.body.indexOf('href="/history"'),
    "history navigation must follow risk navigation",
  );
  assert.doesNotMatch(dashboard.body, LEAK_PATTERN);

  const routeResults = [];
  for (const scenario of routeScenarios) {
    const response = await request(scenario.path, true);
    assert.equal(response.status, 200, `${scenario.label} must return 200`);
    assert.match(response.body, /data-page="history"/);
    assert.match(
      response.body,
      /data-history-semantic="stored-evidence-not-recomputed"/,
    );
    assert.match(response.body, /overflow-x-hidden/);
    assert.doesNotMatch(response.body, LEAK_PATTERN);
    assert.doesNotMatch(
      response.body,
      /account_balance_snapshots|daily_portfolio_snapshots|daily_position_snapshots|event_ledger_entries/i,
    );

    for (const section of scenario.expectedSections) {
      assert.match(
        response.body,
        new RegExp(`data-history-section="${section}"`),
        `${scenario.label} is missing ${section}`,
      );
    }
    for (const section of scenario.absentSections) {
      assert.doesNotMatch(
        response.body,
        new RegExp(`data-history-section="${section}"`),
        `${scenario.label} unexpectedly rendered ${section}`,
      );
    }
    for (const lane of scenario.expectedCharts) {
      const chartTag = readChartTag(response.body, lane);
      assert.equal(
        readStringAttribute(chartTag, "data-history-chart-status"),
        "ready",
      );
      const pointCount = readIntegerAttribute(
        chartTag,
        "data-history-chart-points",
      );
      const segmentCount = readIntegerAttribute(
        chartTag,
        "data-history-chart-segments",
      );
      const sourceCount = readIntegerAttribute(
        chartTag,
        "data-history-chart-sources",
      );
      assert.ok(pointCount > 0, `${scenario.label} ${lane} needs points`);
      assert.ok(
        segmentCount > 0 && segmentCount <= pointCount,
        `${scenario.label} ${lane} has invalid segment count`,
      );
      assert.ok(sourceCount > 0, `${scenario.label} ${lane} needs a source`);
    }
    for (const lane of scenario.absentCharts) {
      assert.doesNotMatch(
        response.body,
        new RegExp(`data-history-chart-lane="${lane}"`),
        `${scenario.label} unexpectedly rendered ${lane} chart`,
      );
    }
    if (scenario.expectedCharts.length > 0) {
      assert.ok(
        response.body.includes("보간하거나 평평한 값으로 채우지 않습니다"),
        `${scenario.label} is missing no-interpolation disclosure`,
      );
    }
    for (const expectedText of scenario.expectedText) {
      assert.ok(
        response.body.includes(expectedText),
        `${scenario.label} is missing expected text: ${expectedText}`,
      );
    }

    let detail = null;
    if (scenario.expectedDetail) {
      const detailTag = readDetailTag(response.body);
      const status = readStringAttribute(
        detailTag,
        "data-history-position-detail-status",
      );
      const reconciliation = readStringAttribute(
        detailTag,
        "data-history-position-reconciliation",
      );
      const positionCount = readIntegerAttribute(
        detailTag,
        "data-history-position-count",
      );
      const legacyOnlyCount = readIntegerAttribute(
        detailTag,
        "data-history-position-legacy-only",
      );
      assert.ok(
        scenario.expectedDetail.allowedStatuses.includes(status),
        `${scenario.label} has unexpected detail status: ${status}`,
      );
      assert.ok(
        scenario.expectedDetail.allowedReconciliation.includes(reconciliation),
        `${scenario.label} has unexpected reconciliation: ${reconciliation}`,
      );
      assert.equal(
        positionCount,
        scenario.expectedDetail.positionCount,
        `${scenario.label} position count drifted`,
      );
      assert.equal(
        legacyOnlyCount,
        scenario.expectedDetail.legacyOnlyCount,
        `${scenario.label} legacy-only count drifted`,
      );
      assert.equal(
        response.body.match(/data-history-position-row="true"/g)?.length ?? 0,
        positionCount,
        `${scenario.label} rendered row count drifted`,
      );
      detail = {
        status,
        reconciliation,
        positionCount,
        legacyOnlyCount,
      };
    }

    let event = null;
    if (scenario.expectedEvent) {
      const eventTag = readEventTag(response.body);
      const status = readStringAttribute(
        eventTag,
        "data-history-event-status",
      );
      const eventCount = readIntegerAttribute(
        eventTag,
        "data-history-event-count",
      );
      const tradeCount = readIntegerAttribute(
        eventTag,
        "data-history-event-trades",
      );
      const lifecycleCount = readIntegerAttribute(
        eventTag,
        "data-history-event-lifecycle",
      );
      const legacyOnlyCount = readIntegerAttribute(
        eventTag,
        "data-history-event-legacy-only",
      );
      const correctionCount = readIntegerAttribute(
        eventTag,
        "data-history-event-corrections",
      );
      assert.ok(
        scenario.expectedEvent.allowedStatuses.includes(status),
        `${scenario.label} has unexpected event status: ${status}`,
      );
      assert.equal(eventCount, scenario.expectedEvent.eventCount);
      assert.equal(tradeCount, scenario.expectedEvent.tradeCount);
      assert.equal(lifecycleCount, scenario.expectedEvent.lifecycleCount);
      assert.equal(legacyOnlyCount, scenario.expectedEvent.legacyOnlyCount);
      assert.equal(correctionCount, scenario.expectedEvent.correctionCount);
      assert.equal(
        response.body.match(/data-history-event-row="true"/g)?.length ?? 0,
        eventCount,
        `${scenario.label} rendered event row count drifted`,
      );
      event = {
        status,
        eventCount,
        tradeCount,
        lifecycleCount,
        legacyOnlyCount,
        correctionCount,
      };
    }

    let comparison = null;
    if (scenario.expectedComparison) {
      const comparisonTag = readComparisonTag(response.body);
      const status = readStringAttribute(
        comparisonTag,
        "data-history-position-comparison-status",
      );
      const rowCount = readIntegerAttribute(
        comparisonTag,
        "data-history-position-comparison-count",
      );
      const addedCount = readIntegerAttribute(
        comparisonTag,
        "data-history-position-comparison-added",
      );
      const removedCount = readIntegerAttribute(
        comparisonTag,
        "data-history-position-comparison-removed",
      );
      const changedCount = readIntegerAttribute(
        comparisonTag,
        "data-history-position-comparison-changed",
      );
      const unchangedCount = readIntegerAttribute(
        comparisonTag,
        "data-history-position-comparison-unchanged",
      );
      const unresolvedCount = readIntegerAttribute(
        comparisonTag,
        "data-history-position-comparison-unresolved",
      );
      assert.equal(status, scenario.expectedComparison.status);
      assert.equal(rowCount, scenario.expectedComparison.rowCount);
      assert.equal(addedCount, scenario.expectedComparison.addedCount);
      assert.equal(removedCount, scenario.expectedComparison.removedCount);
      assert.equal(changedCount, scenario.expectedComparison.changedCount);
      assert.equal(unchangedCount, scenario.expectedComparison.unchangedCount);
      assert.equal(unresolvedCount, 0);
      assert.equal(
        response.body.match(
          /data-history-position-comparison-row="true"/g,
        )?.length ?? 0,
        rowCount,
        `${scenario.label} rendered comparison row count drifted`,
      );
      comparison = {
        status,
        rowCount,
        addedCount,
        removedCount,
        changedCount,
        unchangedCount,
        unresolvedCount,
      };
    }

    const overflowContainers =
      response.body.match(/overflow-x-auto/g)?.length ?? 0;
    assert.ok(
      overflowContainers >= scenario.minimumOverflowContainers,
      `${scenario.label} is missing table overflow containers`,
    );

    routeResults.push({
      label: scenario.label,
      status: response.status,
      expectedSections: scenario.expectedSections.length,
      absentSections: scenario.absentSections.length,
      overflowContainers,
      leakPatternMatches: 0,
      detail,
      event,
      comparison,
    });
  }

  const countsAfter = await readCounts();
  assert.deepEqual(countsAfter, countsBefore, "history render changed DB row counts");

  console.log(
    JSON.stringify(
      {
        smoke: "history_route",
        baseUrl: BASE_URL,
        noAuthStatus: {
          dashboard: unauthorizedDashboard.status,
          history: unauthorizedHistory.status,
        },
        dashboard: {
          status: dashboard.status,
          historyLink: true,
          navigationOrder: "risk_then_history",
        },
        authenticatedRoutes: routeResults,
        databaseSideEffects: false,
        counts: countsAfter,
      },
      null,
      2,
    ),
  );
}

async function readComparisonCandidate() {
  const endpointRows = await sql.query(`
    select p.snapshot_date::text as snapshot_date,
      p.account,
      p.source,
      count(*)::int as position_count
    from daily_position_snapshots p
    where p.account in ('brokerage', 'isa', 'irp')
      and p.is_sample = false
      and exists (
        select 1
        from daily_portfolio_snapshots d
        where d.snapshot_date = p.snapshot_date
          and d.account = p.account
          and d.source = p.source
          and d.is_sample = false
        group by d.snapshot_date, d.account, d.source
        having count(*) = 1
      )
    group by p.snapshot_date, p.account, p.source
    having count(*) <= 200
      and count(*) = count(distinct p.legacy_asset_id)
      and count(p.quantity) = count(*)
      and count(p.market_value_krw) = count(*)
    order by
      case when p.source = 'varda_manual_daily_snapshot' then 0 else 1 end,
      case when p.account = 'brokerage' then 0 else 1 end,
      p.snapshot_date desc
  `);
  const grouped = new Map();
  for (const row of endpointRows) {
    const key = `${row.account}|${row.source}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const endpoints = [...grouped.values()].find((group) => group.length >= 2);
  assert.ok(endpoints, "history smoke needs two comparable stored endpoints");
  const to = endpoints[0];
  const from = endpoints[1];
  const [stats] = await sql.query(`
    with from_rows as (
      select legacy_asset_id, asset_id, ticker, asset_name, market, currency,
        quantity, market_value_krw
      from daily_position_snapshots
      where snapshot_date = $1::date
        and account = $2
        and source = $3
        and is_sample = false
    ),
    to_rows as (
      select legacy_asset_id, asset_id, ticker, asset_name, market, currency,
        quantity, market_value_krw
      from daily_position_snapshots
      where snapshot_date = $4::date
        and account = $2
        and source = $3
        and is_sample = false
    ),
    compared as (
      select f.legacy_asset_id as from_identity,
        t.legacy_asset_id as to_identity,
        f.asset_id as from_asset_id,
        t.asset_id as to_asset_id,
        f.ticker as from_ticker,
        t.ticker as to_ticker,
        f.asset_name as from_name,
        t.asset_name as to_name,
        f.market as from_market,
        t.market as to_market,
        f.currency as from_currency,
        t.currency as to_currency,
        f.quantity as from_quantity,
        t.quantity as to_quantity,
        f.market_value_krw as from_value,
        t.market_value_krw as to_value
      from from_rows f
      full outer join to_rows t using (legacy_asset_id)
    )
    select count(*)::int as row_count,
      count(*) filter (where from_identity is null)::int as added_count,
      count(*) filter (where to_identity is null)::int as removed_count,
      count(*) filter (
        where from_identity is not null and to_identity is not null and (
          from_asset_id is distinct from to_asset_id
          or from_ticker is distinct from to_ticker
          or from_name is distinct from to_name
          or from_market is distinct from to_market
          or from_currency is distinct from to_currency
          or from_quantity is distinct from to_quantity
          or from_value is distinct from to_value
        )
      )::int as changed_count,
      count(*) filter (
        where from_identity is not null and to_identity is not null and not (
          from_asset_id is distinct from to_asset_id
          or from_ticker is distinct from to_ticker
          or from_name is distinct from to_name
          or from_market is distinct from to_market
          or from_currency is distinct from to_currency
          or from_quantity is distinct from to_quantity
          or from_value is distinct from to_value
        )
      )::int as unchanged_count
    from compared
  `, [from.snapshot_date, from.account, from.source, to.snapshot_date]);
  return {
    account: from.account,
    source: from.source,
    fromDate: from.snapshot_date,
    toDate: to.snapshot_date,
    rowCount: Number(stats.row_count),
    addedCount: Number(stats.added_count),
    removedCount: Number(stats.removed_count),
    changedCount: Number(stats.changed_count),
    unchangedCount: Number(stats.unchanged_count),
  };
}

function comparisonScenario(candidate) {
  const params = new URLSearchParams({
    account: candidate.account,
    lane: "portfolio",
    comparisonFrom: `${candidate.fromDate}~${candidate.source}`,
    comparisonTo: `${candidate.toDate}~${candidate.source}`,
  });
  return {
    label: "stored_position_comparison",
    path: `/history?${params.toString()}`,
    expectedSections: ["portfolio"],
    absentSections: ["balance", "events"],
    expectedCharts: ["portfolio"],
    absentCharts: ["balance"],
    expectedText: [
      "두 시점 보유 변화",
      "이전 저장점",
      "이후 저장점",
      "저장 평가액 변화",
      "이벤트 기록은 별도 연대기로 보기",
    ],
    minimumOverflowContainers: 2,
    expectedComparison: {
      status: "ready",
      rowCount: candidate.rowCount,
      addedCount: candidate.addedCount,
      removedCount: candidate.removedCount,
      changedCount: candidate.changedCount,
      unchangedCount: candidate.unchangedCount,
    },
  };
}

async function request(path, authenticated = false) {
  const response = await fetch(new URL(path, BASE_URL), {
    headers: authenticated ? { authorization } : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.text() };
}

async function readCounts() {
  const [row] = await sql.query(`
    select
      (select count(*)::int from assets) as assets,
      (select count(*)::int from account_balance_snapshots) as balance_snapshots,
      (select count(*)::int from daily_portfolio_snapshots) as portfolio_snapshots,
      (select count(*)::int from daily_position_snapshots) as position_snapshots,
      (select count(*)::int from event_ledger_entries) as event_ledger_entries
  `);
  return row;
}

async function readEventStats(account) {
  const [row] = await sql.query(`
    select count(*)::int as event_count,
      count(*) filter (where event_type in ('buy', 'sell'))::int as trade_count,
      count(*) filter (where event_type in ('asset_added', 'asset_removed'))::int as lifecycle_count,
      count(*) filter (where asset_id is null and legacy_asset_id is not null)::int as legacy_only_count,
      count(*) filter (
        where corrects_event_id is not null or legacy_corrects_event_id is not null
      )::int as correction_count,
      count(*) filter (
        where event_type not in ('buy', 'sell', 'asset_added', 'asset_removed')
          or (event_type in ('buy', 'sell') and (
            amount_krw is null or quantity_delta is null or price is null
          ))
          or (asset_id is null and legacy_asset_id is null)
          or corrects_event_id is not null
          or legacy_corrects_event_id is not null
      )::int as partial_count
    from event_ledger_entries
    where account = $1 and is_sample = false
  `, [account]);
  assert.ok(Number(row.event_count) > 0, "history smoke needs named-account events");
  return { account, ...row };
}

function eventScenario(stats) {
  const partialCount = Number(stats.partial_count);
  return {
    label: `${stats.account}_events`,
    path: `/history?account=${encodeURIComponent(stats.account)}&lane=events`,
    expectedSections: ["events"],
    absentSections: ["balance", "portfolio"],
    expectedCharts: [],
    absentCharts: ["balance", "portfolio"],
    expectedText: [
      "저장 이벤트",
      "이벤트 일자",
      "계정 미귀속 이벤트",
      "저장 자산 참조",
      "레거시 전용",
    ],
    minimumOverflowContainers: 1,
    expectedEvent: {
      allowedStatuses: [partialCount > 0 ? "partial" : "ready"],
      eventCount: Number(stats.event_count),
      tradeCount: Number(stats.trade_count),
      lifecycleCount: Number(stats.lifecycle_count),
      legacyOnlyCount: Number(stats.legacy_only_count),
      correctionCount: Number(stats.correction_count),
    },
  };
}

async function readDetailCandidates() {
  const generatedRows = await sql.query(`
    select p.snapshot_date::text as snapshot_date,
      p.account,
      p.source,
      count(*)::int as position_count,
      count(*) filter (where p.asset_id is null)::int as legacy_only_count
    from daily_position_snapshots p
    inner join daily_portfolio_snapshots d
      on d.snapshot_date = p.snapshot_date
      and d.account = p.account
      and d.source = p.source
    where p.account in ('brokerage', 'isa', 'irp')
      and p.source = 'varda_manual_daily_snapshot'
      and p.is_sample = false
      and d.is_sample = false
    group by p.snapshot_date, p.account, p.source
    order by p.snapshot_date desc, p.account asc
    limit 1
  `);
  const legacyRows = await sql.query(`
    select p.snapshot_date::text as snapshot_date,
      p.account,
      p.source,
      count(*)::int as position_count,
      count(*) filter (where p.asset_id is null)::int as legacy_only_count
    from daily_position_snapshots p
    inner join daily_portfolio_snapshots d
      on d.snapshot_date = p.snapshot_date
      and d.account = p.account
      and d.source = p.source
    where p.account in ('brokerage', 'isa', 'irp')
      and p.source = 'base44_import'
      and p.is_sample = false
      and d.is_sample = false
    group by p.snapshot_date, p.account, p.source
    having count(*) filter (where p.asset_id is null) > 0
    order by p.snapshot_date desc, p.account asc
    limit 1
  `);
  assert.ok(generatedRows[0], "history smoke needs a generated detail candidate");
  assert.ok(legacyRows[0], "history smoke needs a legacy-only detail candidate");
  return { generated: generatedRows[0], legacy: legacyRows[0] };
}

function detailScenario(label, candidate, expectations) {
  const params = new URLSearchParams({
    account: candidate.account,
    lane: "portfolio",
    positionDate: candidate.snapshot_date,
    positionSource: candidate.source,
  });
  return {
    label,
    path: `/history?${params.toString()}`,
    expectedSections: ["portfolio"],
    absentSections: ["balance", "events"],
    expectedCharts: ["portfolio"],
    absentCharts: ["balance"],
    expectedText: [
      "과거 보유 상세",
      "포지션 저장 합계",
      "저장 평가액 대조",
      ...expectations.expectedText,
    ],
    minimumOverflowContainers: 3,
    expectedDetail: {
      allowedStatuses: expectations.allowedStatuses,
      allowedReconciliation: expectations.allowedReconciliation,
      positionCount: Number(candidate.position_count),
      legacyOnlyCount: Number(candidate.legacy_only_count),
    },
  };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readChartTag(html, lane) {
  const match = html.match(
    new RegExp(`<figure[^>]*data-history-chart-lane="${lane}"[^>]*>`),
  );
  assert.ok(match, `route is missing ${lane} history chart`);
  return match[0];
}

function readDetailTag(html) {
  const match = html.match(
    /<section[^>]*data-history-position-detail[^>]*>/,
  );
  assert.ok(match, "route is missing history position detail");
  return match[0];
}

function readEventTag(html) {
  const match = html.match(
    /<div[^>]*data-history-event-timeline[^>]*>/,
  );
  assert.ok(match, "route is missing history event timeline");
  return match[0];
}

function readComparisonTag(html) {
  const match = html.match(
    /<section[^>]*data-history-position-comparison[^>]*>/,
  );
  assert.ok(match, "route is missing history position comparison");
  return match[0];
}

function readIntegerAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="(\\d+)"`));
  assert.ok(match, `chart is missing numeric attribute: ${name}`);
  return Number(match[1]);
}

function readStringAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="([a-z0-9_]+)"`));
  assert.ok(match, `chart is missing string attribute: ${name}`);
  return match[1];
}

await main();
