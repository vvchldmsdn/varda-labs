import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TENANT_CONTEXT_SETTING_NAME,
  TENANT_DATABASE_ROLE_NAME,
} from "../src/lib/deployment/tenant-security-constants.ts";
import { TENANT_TRANSACTION_CONTEXT_POLICY } from "../src/lib/deployment/tenant-transaction-context.ts";
import { tenantDatabaseRole } from "../src/db/tenant-rls-policy.ts";

const migration = readFileSync(
  "drizzle/0028_conscious_post.sql",
  "utf8",
);
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe("accounts tenant RLS canary", () => {
  it("shares the reviewed role and transaction setting names", () => {
    assert.equal(TENANT_DATABASE_ROLE_NAME, "varda_tenant_app");
    assert.equal(TENANT_CONTEXT_SETTING_NAME, "app.current_user_id");
    assert.equal(
      TENANT_TRANSACTION_CONTEXT_POLICY.settingName,
      TENANT_CONTEXT_SETTING_NAME,
    );
    assert.equal(tenantDatabaseRole.name, TENANT_DATABASE_ROLE_NAME);
  });

  it("contains only RLS enablement, one SELECT policy, and one SELECT grant", () => {
    assert.deepEqual(statements, [
      'ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "accounts_tenant_select_v1" ON "accounts" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("accounts"."canonical_owner_user_id" = nullif(current_setting(\'app.current_user_id\', true), \'\')::uuid);',
      'GRANT SELECT ON TABLE "accounts" TO "varda_tenant_app";',
    ]);
  });

  it("does not force RLS, grant writes, mutate rows, or create roles", () => {
    assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/i);
    assert.doesNotMatch(migration, /WITH CHECK/i);
    assert.doesNotMatch(
      migration,
      /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)/i,
    );
    assert.doesNotMatch(
      migration,
      /^\s*(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE|DROP|CREATE ROLE|ALTER ROLE)\b/gim,
    );
  });

  it("keeps the active Drizzle schema aligned with the canary", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const policy = readFileSync("src/db/tenant-rls-policy.ts", "utf8");

    assert.match(schema, /pgPolicy\("accounts_tenant_select_v1"/);
    assert.match(schema, /for: "select"/);
    assert.match(schema, /using: currentTenantOwns\(table\.canonicalOwnerUserId\)/);
    assert.match(schema, /\)\.enableRLS\(\);/);
    assert.match(policy, /pgRole\([\s\S]*TENANT_DATABASE_ROLE_NAME[\s\S]*\)\.existing\(\)/);
    assert.match(policy, /current_setting\(\$\{settingName\}, true\)/);
  });

  it("keeps the executable audit SELECT-only and sanitized", () => {
    const audit = readFileSync(
      "scripts/audit-accounts-tenant-rls.ts",
      "utf8",
    );

    assert.match(audit, /privilegedSql\.query/);
    assert.doesNotMatch(audit, /privilegedSql\.transaction/);
    assert.match(audit, /databaseSideEffects: false/);
    assert.match(audit, /runTenantReadTransaction/);
    assert.doesNotMatch(
      audit,
      /\b(?:insert|update|delete|merge|copy|truncate|alter|drop|grant|revoke)\s+(?:into|table|from|on|select)\b/i,
    );
    assert.doesNotMatch(audit, /console\.log\(process\.env/);
    assert.doesNotMatch(audit, /\bownerUserId\s*:/);
  });

  it("routes the account-management account read through the RLS transaction", () => {
    const query = readFileSync(
      "src/db/queries/account-management.ts",
      "utf8",
    );
    const accountSql = query.match(
      /const ACCOUNT_MANAGEMENT_ACCOUNT_ROWS_SQL = `([\s\S]*?)`;/,
    )?.[1];

    assert.match(query, /runTenantReadTransaction\(ownerUserId/);
    assert.ok(accountSql);
    assert.match(accountSql, /from public\.accounts/);
    assert.doesNotMatch(accountSql, /canonical_owner_user_id|owner_user_id/);
    assert.match(query, /eq\(assets\.canonicalOwnerUserId, ownerUserId\)/);
  });
});
