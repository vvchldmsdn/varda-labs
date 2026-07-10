import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  ACCOUNT_ENTITY_API_RESPONSE_KEYS,
  ASSET_ENTITY_API_RESPONSE_KEYS,
  ASSET_GROUP_ENTITY_API_RESPONSE_KEYS,
  ASSET_GROUP_MEMBER_ENTITY_API_RESPONSE_KEYS,
} from "../src/lib/entity-api-contract.ts";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const ADMIN_SECRET = (
  process.env.ADMIN_JOB_SECRET ?? process.env.CRON_SECRET
)?.trim();
const APP_PASSWORD = (
  process.env.VARDA_APP_PASSWORD ?? process.env.APP_ACCESS_PASSWORD
)?.trim();
const APP_USER = process.env.VARDA_APP_USER?.trim() || "varda";
const OWNER_KEY_PATTERN =
  /ownerUserId|owner_user_id|canonicalOwnerUserId|canonical_owner_user_id|legacyOwnerUserId|legacy_owner_user_id|createdById|created_by_id|providerSubject|provider_subject/i;

const entityScenarios = [
  {
    label: "accounts",
    path: "/api/entities/accounts",
    keys: ACCOUNT_ENTITY_API_RESPONSE_KEYS,
  },
  {
    label: "assets",
    path: "/api/entities/assets",
    keys: ASSET_ENTITY_API_RESPONSE_KEYS,
  },
  {
    label: "asset_groups",
    path: "/api/entities/asset-groups",
    keys: ASSET_GROUP_ENTITY_API_RESPONSE_KEYS,
  },
  {
    label: "asset_group_members",
    path: "/api/entities/asset-group-members",
    keys: ASSET_GROUP_MEMBER_ENTITY_API_RESPONSE_KEYS,
  },
];

const productPaths = [
  "/",
  "/today",
  "/history",
  "/portfolio/structure",
  "/portfolio/risk",
  "/market",
  "/etfs",
];

if (!ADMIN_SECRET) throw new Error("Admin job secret is not configured");
if (!APP_PASSWORD) throw new Error("Dashboard access password is not configured");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const basicAuthorization = `Basic ${Buffer.from(
  `${APP_USER}:${APP_PASSWORD}`,
).toString("base64")}`;

async function main() {
  const countsBefore = await readCounts();
  const entityResults = [];

  for (const scenario of entityScenarios) {
    const unauthorized = await request(scenario.path);
    assert.equal(unauthorized.status, 401, `${scenario.label} no-auth must be 401`);

    const authorized = await request(scenario.path, {
      authorization: `Bearer ${ADMIN_SECRET}`,
    });
    assert.equal(authorized.status, 200, `${scenario.label} admin GET must be 200`);

    const rows = JSON.parse(authorized.body);
    assert.ok(Array.isArray(rows), `${scenario.label} response must be an array`);
    for (const row of rows) {
      assert.deepEqual(
        Object.keys(row).sort(),
        [...scenario.keys].sort(),
        `${scenario.label} response keys changed`,
      );
      assert.doesNotMatch(JSON.stringify(row), OWNER_KEY_PATTERN);
    }

    assertSecretAbsent(authorized.body);
    entityResults.push({
      label: scenario.label,
      noAuthStatus: unauthorized.status,
      authStatus: authorized.status,
      rows: rows.length,
      responseKeyCount: scenario.keys.length,
    });
  }

  const productResults = [];
  for (const path of productPaths) {
    const response = await request(path, { authorization: basicAuthorization });
    assert.equal(response.status, 200, `${path} must return 200`);
    assert.doesNotMatch(response.body, OWNER_KEY_PATTERN);
    assertSecretAbsent(response.body);
    productResults.push({ path, status: response.status });
  }

  const countsAfter = await readCounts();
  assert.deepEqual(countsAfter, countsBefore, "boundary smoke changed DB rows");

  console.log(
    JSON.stringify(
      {
        smoke: "entity_api_boundary",
        baseUrl: BASE_URL,
        entities: entityResults,
        productRoutes: productResults,
        ownerKeyLeaks: 0,
        secretLeaks: 0,
        databaseSideEffects: false,
        counts: countsAfter,
      },
      null,
      2,
    ),
  );
}

async function request(path, headers) {
  const response = await fetch(new URL(path, BASE_URL), {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });

  return { status: response.status, body: await response.text() };
}

async function readCounts() {
  const [row] = await sql.query(`
    select
      (select count(*)::int from accounts) as accounts,
      (select count(*)::int from assets) as assets,
      (select count(*)::int from asset_groups) as asset_groups,
      (select count(*)::int from asset_group_members) as asset_group_members
  `);
  return row;
}

function assertSecretAbsent(body) {
  assert.equal(body.includes(ADMIN_SECRET), false, "admin secret leaked");
  assert.equal(body.includes(APP_PASSWORD), false, "app password leaked");
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

await main();
