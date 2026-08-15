import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const SESSION_COOKIE =
  readArgument("--session-cookie") ??
  process.env.VARDA_SESSION_COOKIE?.trim() ??
  null;
const LEAK_PATTERN =
  /legacyBase44Id|providerSubject|canonicalOwnerUserId|ownerUserId|api[_-]?key|authorization|password|secret|token|account_balance_snapshots|daily_portfolio_snapshots|daily_position_snapshots|event_ledger_entries|\b[0-9a-f]{24}\b/i;

async function main() {
  const [historyBoundary, dashboardBoundary] = await Promise.all([
    request("/history?scope=all&lane=portfolio"),
    request("/"),
  ]);

  assert.equal(historyBoundary.status, 200, "history shell must return 200");
  assert.equal(dashboardBoundary.status, 200, "dashboard shell must return 200");
  assert.match(historyBoundary.body, /히스토리/);
  assert.match(historyBoundary.body, /로그인 세션과 사용자 소유권/);
  assert.match(historyBoundary.body, /상품 데이터 조회/);
  assert.match(historyBoundary.body, /시도하지 않음/);
  assert.match(historyBoundary.body, /href="\/auth\/sign-in"/);
  assert.doesNotMatch(historyBoundary.body, /data-page="history"/);
  assert.doesNotMatch(historyBoundary.body, LEAK_PATTERN);
  assert.doesNotMatch(dashboardBoundary.body, LEAK_PATTERN);

  if (!SESSION_COOKIE) {
    console.log(
      JSON.stringify(
        {
          smoke: "history_session_boundary",
          baseUrl: BASE_URL,
          status: {
            dashboard: dashboardBoundary.status,
            history: historyBoundary.status,
          },
          tenantSession: "not_present",
          productDataRead: "not_attempted",
          sensitivePatternExposed: false,
        },
        null,
        2,
      ),
    );
    return;
  }

  const history = await request(
    "/history?scope=all&lane=portfolio",
    SESSION_COOKIE,
  );
  assert.equal(history.status, 200, "session-bound history must return 200");
  assert.match(history.body, /data-page="history"/);
  assert.match(history.body, /name="scope"/);
  assert.doesNotMatch(history.body, LEAK_PATTERN);

  console.log(
    JSON.stringify(
      {
        smoke: "history_session_read",
        baseUrl: BASE_URL,
        status: history.status,
        tenantSession: "present",
        sensitivePatternExposed: false,
      },
      null,
      2,
    ),
  );
}

async function request(path, cookie = null) {
  const response = await fetch(new URL(path, BASE_URL), {
    headers: cookie ? { cookie } : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.text() };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

await main();
