import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { buildTargetPolicyHoldingUniverse } from "../src/lib/target-policy-holding-universe.ts";
import { buildTargetPolicyReviewPacket } from "../src/lib/target-policy-review-packet.ts";

const ownerUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const assetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const scope = { kind: "account", key: `account:${accountId}`, label: "Fixture", accountId, accountCode: "brokerage" };
const asset = {
  id: assetId, assetId, accountId, account: "brokerage", accountCode: "brokerage",
  accountName: "Fixture", name: "Fixture QQQ", assetName: "Fixture QQQ",
  ticker: "QQQ", market: "us", currency: "USD", assetType: "etf", quantity: "1",
  averageCost: "100", currentPrice: "110", fractionalKrwValue: "0", fractionalAvgCost: null,
  groupId: null, targetWeight: "100", legacyBase44Id: null, maAssetClass: "large_growth", maRuleEnabled: true,
};

describe("additional contribution scoped valuation reuse", () => {
  for (const legacyAvailable of [false, true]) {
    it(`${legacyAvailable ? "validates a legacy vector" : "reports a missing legacy policy"} without repeating the real valuation pipeline`, async () => {
      const reads = [];
      const db = { select() {
        let table;
        const builder = {
          from(value) { table = getTableName(value); return builder; },
          innerJoin() { return builder; }, where() { return builder; },
          orderBy() { return builder; }, limit() { return builder; },
          then(resolve, reject) {
            reads.push(table);
            return Promise.resolve(table === "assets" ? [asset] : []).then(resolve, reject);
          },
        };
        return builder;
      } };
      const universe = buildTargetPolicyHoldingUniverse({ account: "brokerage", holdings: [asset] });
      const packet = buildTargetPolicyReviewPacket({
        account: "brokerage", policyVersion: "fixture-v1", effectiveServiceDate: "2026-07-01",
        currentHoldings: universe.rows,
        decisions: [{ market: "us", currency: "USD", ticker: "QQQ", targetWeightBps: 10000, decision: "positive_target", exclusionReason: null }],
      });
      assert.equal(packet.status, "reviewable");
      const legacy = legacyAvailable ? {
        status: "available",
        policy: { approvalState: "approved", policyId: packet.policy.policyId, account: "brokerage",
          policyVersion: "fixture-v1", effectiveServiceDate: "2026-07-01", universeHash: universe.universeHash,
          vectorHash: packet.vectorHash, vector: packet.canonicalVector },
      } : { status: "missing", policy: null };
      const [query] = await importWithPorts(["src/db/queries/additional-contribution.ts"], {
        "@/db/client": { db },
        "@/db/queries/tenant-group-reads": {
          loadActiveTenantAllocationGroupBundle: async () => ({ groups: [], members: [] }),
          loadTenantPortfolioGroupMemberships: async () => ({ accountMemberships: [], assetMemberships: [] }),
        },
        "@/db/queries/tenant-settings": { loadLatestTenantPortfolioSettingsRows: async () => [{ usdKrwRate: "1400", useTrendFilter: false }] },
        "@/db/queries/portfolio-fx-rates": { loadUsablePortfolioFxRows: async () => [{ usdKrw: "1400", status: "ok", isSample: false }] },
        "@/db/queries/tenant-target-policies": { loadCurrentTenantPortfolioTargetPolicy: async () => ({ status: "missing", policy: null }) },
        "@/db/queries/target-policy": { getReadOnlyTenantApprovedTargetPolicy: async ({ tenantContext }) => {
          assert.equal(tenantContext.ownerUserId, ownerUserId);
          return legacy;
        } },
        "@/db/queries/additional-contribution-ma120": { getReadOnlyTenantAdditionalContributionMa120Evidence: async () => {
          assert.ok(legacyAvailable, "a missing policy must not read MA evidence");
          return { policyVersion: "fixture", allocationEffect: "bounded_overlay", status: "unavailable",
            suppliedHoldingCount: 1, evaluatedHoldingCount: 0, usableCount: 0, unavailableCount: 1, rows: [] };
        } },
      });
      const result = await query.getReadOnlyTenantAdditionalContributionPreviewForScope({
        cashAmountKrw: 1000, scope, tenantContext: { ownerUserId }, now: new Date("2026-09-08T01:00:00Z"),
      });
      assert.equal(result.source, "legacy_account_policy");
      assert.equal(result.status, legacyAvailable ? "ready" : "blocked");
      assert.equal(reads.filter(table => table === "assets").length, legacyAvailable ? 3 : 2);
      assert.equal(reads.filter(table => table === "live_price_quotes").length, 1);
      if (legacyAvailable) {
        assert.equal(result.rows[0].allocationKey, `${accountId}:${assetId}`);
        assert.equal(result.currentPortfolioTotalKrw, 154000);
        assert.equal(result.rows[0].targetWeightPct, 100);
      } else {
        assert.deepEqual(result.blockers, ["target_policy_missing"]);
      }
    });
  }
});
