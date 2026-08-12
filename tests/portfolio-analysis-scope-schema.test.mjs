import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const MIGRATION_PATH = join(ROOT, "drizzle", "0024_nebulous_tag.sql");
const SCHEMA_PATH = join(ROOT, "src", "db", "schema.ts");
const migration = readFileSync(MIGRATION_PATH, "utf8");
const schema = readFileSync(SCHEMA_PATH, "utf8");
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const TABLES = [
  "portfolio_group_account_memberships",
  "portfolio_group_asset_memberships",
  "portfolio_groups",
].sort();

const FOREIGN_KEYS = [
  "portfolio_group_account_memberships_account_owner_fk",
  "portfolio_group_account_memberships_group_owner_fk",
  "portfolio_group_account_memberships_owner_user_fk",
  "portfolio_group_asset_memberships_asset_owner_fk",
  "portfolio_group_asset_memberships_group_owner_fk",
  "portfolio_group_asset_memberships_owner_user_fk",
  "portfolio_groups_owner_user_fk",
].sort();

describe("dynamic portfolio analysis scope schema", () => {
  it("adds only the three empty normalized portfolio-group tables", () => {
    const createdTables = [...migration.matchAll(/CREATE TABLE "([^"]+)"/g)]
      .map((match) => match[1])
      .sort();

    assert.deepEqual(createdTables, TABLES);
    for (const statement of statements) {
      assert.doesNotMatch(
        statement,
        /^(?:INSERT|UPDATE|DELETE|MERGE|COPY)\b/i,
      );
    }
    assert.doesNotMatch(
      migration,
      /\b(?:brokerage|isa|irp|target_policy|asset_groups)\b/i,
    );
  });

  it("binds every membership to the same canonical owner", () => {
    const foreignKeys = [...migration.matchAll(
      /ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g,
    )]
      .map((match) => match[1])
      .sort();

    assert.deepEqual(foreignKeys, FOREIGN_KEYS);
    for (const statement of statements.filter((value) =>
      value.includes("FOREIGN KEY"),
    )) {
      assert.match(statement, /ON DELETE restrict ON UPDATE no action;?$/);
    }
    assert.match(
      migration,
      /FOREIGN KEY \("portfolio_group_id","canonical_owner_user_id"\).*REFERENCES "public"\."portfolio_groups"\("id","canonical_owner_user_id"\)/,
    );
    assert.match(
      migration,
      /FOREIGN KEY \("account_id","canonical_owner_user_id"\).*REFERENCES "public"\."accounts"\("id","canonical_owner_user_id"\)/,
    );
    assert.match(
      migration,
      /FOREIGN KEY \("asset_id","canonical_owner_user_id"\).*REFERENCES "public"\."assets"\("id","canonical_owner_user_id"\)/,
    );
    assert.ok(
      migration.indexOf('CREATE UNIQUE INDEX "assets_id_canonical_owner_unique"') <
        migration.indexOf(
          'ADD CONSTRAINT "portfolio_group_asset_memberships_asset_owner_fk"',
        ),
      "the referenced assets owner key must exist before its foreign key",
    );
    assert.ok(
      migration.indexOf(
        'CREATE UNIQUE INDEX "portfolio_groups_id_canonical_owner_unique"',
      ) <
        migration.indexOf(
          'ADD CONSTRAINT "portfolio_group_account_memberships_group_owner_fk"',
        ),
      "the referenced portfolio group owner key must exist before its account-membership foreign key",
    );
    assert.ok(
      migration.indexOf(
        'CREATE UNIQUE INDEX "portfolio_groups_id_canonical_owner_unique"',
      ) <
        migration.indexOf(
          'ADD CONSTRAINT "portfolio_group_asset_memberships_group_owner_fk"',
        ),
      "the referenced portfolio group owner key must exist before its asset-membership foreign key",
    );
  });

  it("keeps group deletion archival and memberships effective-dated", () => {
    assert.match(migration, /"archived_at" timestamp with time zone/);
    assert.match(
      migration,
      /"valid_to" is null or "portfolio_group_account_memberships"\."valid_to" > "portfolio_group_account_memberships"\."valid_from"/,
    );
    assert.match(
      migration,
      /"valid_to" is null or "portfolio_group_asset_memberships"\."valid_to" > "portfolio_group_asset_memberships"\."valid_from"/,
    );
    assert.match(
      migration,
      /"portfolio_group_account_memberships_active_unique".*WHERE .*"valid_to" is null/,
    );
    assert.match(
      migration,
      /"portfolio_group_asset_memberships_active_unique".*WHERE .*"valid_to" is null/,
    );
    assert.doesNotMatch(migration, /ON DELETE cascade/i);
  });

  it("keeps the active Drizzle schema aligned with the generated migration", () => {
    for (const exportName of [
      "portfolioGroups",
      "portfolioGroupAccountMemberships",
      "portfolioGroupAssetMemberships",
    ]) {
      assert.match(schema, new RegExp(`export const ${exportName} = pgTable`));
    }
    assert.match(schema, /assets_id_canonical_owner_unique/);
    assert.match(schema, /export type PortfolioGroup =/);
    assert.match(schema, /export type PortfolioGroupAccountMembership =/);
    assert.match(schema, /export type PortfolioGroupAssetMembership =/);
  });
});
