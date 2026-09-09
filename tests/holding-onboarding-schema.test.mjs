import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../drizzle/0025_nebulous_the_phantom.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../src/db/schema.ts", import.meta.url),
  "utf8",
);

describe("holding onboarding schema", () => {
  it("allows an unknown cost without changing known costs or accepting zero", async () => {
    const optionalCostMigration = readFileSync(new URL("../drizzle/0042_holding_onboarding_optional_cost.sql", import.meta.url), "utf8");
    assert.equal(optionalCostMigration.trim(), 'ALTER TABLE "holding_onboarding_evidence" ALTER COLUMN "average_cost" DROP NOT NULL;');
    const pg = new PGlite();
    try {
      await pg.exec("create table holding_onboarding_evidence(id integer primary key,average_cost numeric not null check(average_cost>0)); insert into holding_onboarding_evidence values(1,123.45);");
      await pg.exec(optionalCostMigration);
      await pg.exec("insert into holding_onboarding_evidence values(2,null)");
      assert.deepEqual((await pg.query("select id,average_cost from holding_onboarding_evidence order by id")).rows, [{ id: 1, average_cost: "123.45" }, { id: 2, average_cost: null }]);
      await assert.rejects(pg.exec("insert into holding_onboarding_evidence values(3,0)"), /check constraint/);
    } finally { await pg.close(); }
  });

  it("adds one immutable owner-scoped evidence table", () => {
    assert.match(migration, /CREATE TABLE "holding_onboarding_evidence"/);
    assert.match(
      migration,
      /FOREIGN KEY \("asset_id","canonical_owner_user_id"\).*REFERENCES "public"\."assets"\("id","canonical_owner_user_id"\)/,
    );
    assert.match(
      migration,
      /FOREIGN KEY \("account_id","canonical_owner_user_id"\).*REFERENCES "public"\."accounts"\("id","canonical_owner_user_id"\)/,
    );
    assert.match(
      migration,
      /FOREIGN KEY \("asset_id","account_id"\).*REFERENCES "public"\."assets"\("id","account_id"\)/,
    );
    assert.match(
      migration,
      /holding_onboarding_evidence_policy_version_check.*holding_onboarding_v1/,
    );
  });

  it("prevents duplicate aggregate holdings per owner and account", () => {
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "assets_owner_account_instrument_unique".*canonical_owner_user_id.*account_id.*lower\(btrim\("market"\)\).*upper\(btrim\("currency"\)\).*upper\(btrim\("ticker"\)\)/,
    );
    assert.match(
      migration,
      /WHERE "assets"\."canonical_owner_user_id" is not null and "assets"\."account_id" is not null and "assets"\."ticker" is not null/,
    );
  });

  it("is expand-only and keeps Drizzle aligned", () => {
    for (const forbidden of [
      /\bDROP\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bUPDATE\s+[^;]+\s+SET\b/i,
      /\bTRUNCATE\b/i,
      /\bINSERT\s+INTO\b/i,
      /\bALTER\s+(?:TABLE\s+[^;]+\s+)?ALTER\s+COLUMN\b/i,
      /\bRENAME\b/i,
    ]) {
      assert.doesNotMatch(migration, forbidden);
    }
    for (const token of [
      "holdingOnboardingEvidence",
      "holding_onboarding_evidence_asset_owner_fk",
      "holding_onboarding_evidence_account_owner_fk",
      "assets_owner_account_instrument_unique",
    ]) {
      assert.match(schema, new RegExp(token));
    }
  });
});
