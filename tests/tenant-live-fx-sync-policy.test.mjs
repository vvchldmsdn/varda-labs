import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planTenantLiveFxSync,
  TENANT_LIVE_FX_SYNC_POLICY,
} from "../src/lib/market-data/tenant-live-fx-sync-policy.ts";

describe("tenant live FX sync policy", () => {
  const now = new Date("2026-08-24T11:32:00.000Z");

  it("does not call an FX provider when the selected scope has no USD exposure", () => {
    assert.deepEqual(
      planTenantLiveFxSync({
        currencies: ["KRW"],
        evidence: null,
        now,
        reason: "page_view",
      }),
      { hasUsdExposure: false, shouldRefresh: false, state: "not_required" },
    );
  });

  it("refreshes missing or stale USD/KRW evidence on page view", () => {
    const staleFetchedAt = new Date(
      now.getTime() - TENANT_LIVE_FX_SYNC_POLICY.freshnessMilliseconds - 1,
    );

    assert.equal(planTenantLiveFxSync({
      currencies: ["USD"],
      evidence: null,
      now,
      reason: "page_view",
    }).shouldRefresh, true);
    assert.equal(planTenantLiveFxSync({
      currencies: ["USD"],
      evidence: { usdKrw: "1493.62", status: "ok", fetchedAt: staleFetchedAt },
      now,
      reason: "page_view",
    }).shouldRefresh, true);
  });

  it("reuses fresh evidence on page view but manual refresh always asks the provider", () => {
    const evidence = {
      usdKrw: "1493.62",
      status: "ok",
      fetchedAt: new Date(now.getTime() - 30_000),
    };

    assert.deepEqual(planTenantLiveFxSync({
      currencies: ["USD"],
      evidence,
      now,
      reason: "page_view",
    }), { hasUsdExposure: true, shouldRefresh: false, state: "fresh" });
    assert.deepEqual(planTenantLiveFxSync({
      currencies: ["USD"],
      evidence,
      now,
      reason: "manual",
    }), { hasUsdExposure: true, shouldRefresh: true, state: "refresh" });
  });
});
