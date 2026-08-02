import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const PASSWORD =
  process.env.VARDA_APP_PASSWORD?.trim() ||
  process.env.APP_ACCESS_PASSWORD?.trim();
const USERNAME = process.env.VARDA_APP_USER?.trim() || "varda";
const LEAK_PATTERN =
  /legacyBase44Id|providerSubject|canonicalOwnerUserId|ownerUserId|api[_-]?key|authorization|password|secret|token|account_balance_snapshots|daily_portfolio_snapshots|daily_position_snapshots|event_ledger_entries|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i;

if (!PASSWORD) throw new Error("Dashboard access password is not configured");

const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;

async function main() {
  const [unauthorizedHistory, unauthorizedDashboard] = await Promise.all([
    request("/history"),
    request("/"),
  ]);
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

  const [history, dashboard] = await Promise.all([
    request("/history?account=all&lane=all", true),
    request("/", true),
  ]);
  assert.equal(history.status, 200, "authenticated history must return 200");
  assert.equal(dashboard.status, 200, "authenticated dashboard must return 200");
  assert.match(history.body, /히스토리/);
  assert.match(history.body, /로그인 세션과 사용자 소유권이 확인된 기록만 조회합니다/);
  assert.match(history.body, /상품 데이터 조회/);
  assert.match(history.body, /시도하지 않음/);
  assert.match(history.body, /href="\/auth\/sign-in"/);
  assert.doesNotMatch(history.body, /data-history-section=/);
  assert.doesNotMatch(history.body, LEAK_PATTERN);
  assert.doesNotMatch(dashboard.body, LEAK_PATTERN);

  console.log(
    JSON.stringify({
      smoke: "history_session_boundary",
      baseUrl: BASE_URL,
      noAuthStatus: {
        dashboard: unauthorizedDashboard.status,
        history: unauthorizedHistory.status,
      },
      basicAuthStatus: {
        dashboard: dashboard.status,
        history: history.status,
      },
      tenantSession: "not_present",
      productDataRead: "not_attempted",
      sensitivePatternExposed: false,
    }),
  );
}

async function request(path, authenticated = false) {
  const response = await fetch(new URL(path, BASE_URL), {
    headers: authenticated ? { authorization } : undefined,
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
