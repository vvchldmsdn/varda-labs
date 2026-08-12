import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0025_nebulous_the_phantom.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../src/db/schema.ts", import.meta.url),
  "utf8",
);

describe("holding onboarding schema", () => {
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
