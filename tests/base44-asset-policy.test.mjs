import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXCLUDED_BASE44_ASSET_TYPES,
  isExcludedBase44AssetType,
} from "../scripts/lib/base44-asset-policy.mjs";

describe("Base44 asset migration policy", () => {
  it("excludes legacy savings and housing subscription assets", () => {
    assert.deepEqual(EXCLUDED_BASE44_ASSET_TYPES, [
      "housing_subscription",
      "savings",
    ]);
    assert.equal(isExcludedBase44AssetType("savings"), true);
    assert.equal(isExcludedBase44AssetType(" Housing_Subscription "), true);
  });

  it("keeps investment and commodity assets eligible for import", () => {
    assert.equal(isExcludedBase44AssetType("etf"), false);
    assert.equal(isExcludedBase44AssetType("commodity"), false);
    assert.equal(isExcludedBase44AssetType(null), false);
  });
});
