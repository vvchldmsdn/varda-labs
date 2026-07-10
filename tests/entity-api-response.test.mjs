import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import {
  ACCOUNT_ENTITY_API_RESPONSE_KEYS,
  ASSET_ENTITY_API_RESPONSE_KEYS,
  ASSET_GROUP_ENTITY_API_RESPONSE_KEYS,
  ASSET_GROUP_MEMBER_ENTITY_API_RESPONSE_KEYS,
  projectEntityApiRow,
} from "../src/lib/entity-api-contract.ts";

const ROOT = process.cwd();
const FORBIDDEN_OWNER_KEYS = [
  "ownerUserId",
  "owner_user_id",
  "canonicalOwnerUserId",
  "canonical_owner_user_id",
  "legacyOwnerUserId",
  "legacy_owner_user_id",
  "createdById",
  "created_by_id",
  "providerSubject",
  "provider_subject",
];

const EXPECTED_KEYS = {
  account: [
    "id",
    "code",
    "name",
    "accountType",
    "currency",
    "isActive",
    "sortOrder",
    "createdAt",
    "updatedAt",
  ],
  asset: [
    "id",
    "legacyBase44Id",
    "name",
    "ticker",
    "assetType",
    "category",
    "market",
    "currency",
    "account",
    "accountId",
    "quantity",
    "currentPrice",
    "priceSource",
    "priceFetchedAt",
    "priceAsOf",
    "priceQuoteType",
    "priceStatus",
    "priceError",
    "averageCost",
    "targetWeight",
    "groupId",
    "memo",
    "description",
    "maAssetClass",
    "maRuleEnabled",
    "ma120",
    "daysAboveMa",
    "fractionalKrwValue",
    "fractionalAvgCost",
    "monthlyContribution",
    "contributionDay",
    "createdAt",
    "updatedAt",
  ],
  assetGroup: [
    "id",
    "legacyBase44Id",
    "name",
    "targetWeight",
    "description",
    "color",
    "isActive",
    "sortOrder",
    "fxExempt",
    "maExempt",
    "executionMode",
    "createdAt",
    "updatedAt",
  ],
  assetGroupMember: [
    "id",
    "groupId",
    "assetId",
    "priority",
    "allocationRatio",
    "sortOrder",
    "isActive",
    "createdAt",
    "updatedAt",
  ],
};

describe("entity API response boundary", () => {
  it("freezes the existing non-owner response key sets", () => {
    assert.deepEqual([...ACCOUNT_ENTITY_API_RESPONSE_KEYS], EXPECTED_KEYS.account);
    assert.deepEqual([...ASSET_ENTITY_API_RESPONSE_KEYS], EXPECTED_KEYS.asset);
    assert.deepEqual(
      [...ASSET_GROUP_ENTITY_API_RESPONSE_KEYS],
      EXPECTED_KEYS.assetGroup,
    );
    assert.deepEqual(
      [...ASSET_GROUP_MEMBER_ENTITY_API_RESPONSE_KEYS],
      EXPECTED_KEYS.assetGroupMember,
    );
  });

  it("does not project current or future owner evidence", () => {
    for (const keys of [
      ACCOUNT_ENTITY_API_RESPONSE_KEYS,
      ASSET_ENTITY_API_RESPONSE_KEYS,
      ASSET_GROUP_ENTITY_API_RESPONSE_KEYS,
      ASSET_GROUP_MEMBER_ENTITY_API_RESPONSE_KEYS,
    ]) {
      const input = Object.fromEntries([
        ...keys.map((key) => [key, `value:${key}`]),
        ...FORBIDDEN_OWNER_KEYS.map((key) => [key, `private:${key}`]),
      ]);
      const projected = projectEntityApiRow(keys, input);

      assert.deepEqual(Object.keys(projected), [...keys]);
      for (const forbiddenKey of FORBIDDEN_OWNER_KEYS) {
        assert.equal(Object.hasOwn(projected, forbiddenKey), false);
      }
    }
  });

  it("forbids unqualified select and returning in entity routes", () => {
    const routeFiles = walk(join(ROOT, "src", "app", "api", "entities"))
      .filter((path) => path.endsWith("route.ts"))
      .sort();

    assert.equal(routeFiles.length, 8);

    for (const path of routeFiles) {
      const source = readFileSync(path, "utf8");
      const label = relative(ROOT, path);

      assert.doesNotMatch(source, /\.(?:select|returning)\(\s*\)/, label);
      assert.doesNotMatch(
        source,
        /canonicalOwnerUserId|canonical_owner_user_id|legacyOwnerUserId|legacy_owner_user_id/,
        label,
      );
      assert.match(source, /EntityApiSelection/, label);
    }
  });

  it("keeps owner fields out of product render source", () => {
    const productFiles = [
      ...walk(join(ROOT, "src", "components")),
      ...walk(join(ROOT, "src", "app")).filter(
        (path) => !path.includes(`${join("src", "app", "api")}`),
      ),
    ].filter((path) => /\.(?:ts|tsx)$/.test(path));

    const forbiddenPattern = new RegExp(FORBIDDEN_OWNER_KEYS.join("|"));
    for (const path of productFiles) {
      assert.doesNotMatch(
        readFileSync(path, "utf8"),
        forbiddenPattern,
        relative(ROOT, path),
      );
    }
  });
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
