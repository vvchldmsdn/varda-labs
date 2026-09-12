import { buildHomeDesignPreview } from "./home-design-preview.ts";
import type { PortfolioStructureHoldingRow, PortfolioStructureGroupRow } from "./portfolio-structure.ts";

export const DEMO_VIEWS = ["home", "today", "structure", "contribution", "lab", "simulation", "history"] as const;
export type DemoView = typeof DEMO_VIEWS[number];
export function isDemoView(value: string): value is DemoView { return DEMO_VIEWS.some(view => view === value); }
export const DEMO_ACCOUNTS = ["all", "brokerage", "isa", "irp"] as const;
export type DemoAccount = typeof DEMO_ACCOUNTS[number];
export function demoAccount(value: unknown): DemoAccount {
  return typeof value === "string" && DEMO_ACCOUNTS.some(account => account === value) ? value as DemoAccount : "all";
}
const scopeKeys = { all: "all", brokerage: "account:11111111-1111-4111-8111-111111111111", isa: "account:22222222-2222-4222-8222-222222222222", irp: "account:33333333-3333-4333-8333-333333333333" };
// One deterministic portfolio supplies the home, movement, structure and funding
// views. No request identity, database, live price or account creation is involved.
export function buildDemoPortfolio(accountInput: unknown = "all") {
  const account = demoAccount(accountInput);
  const dashboard = buildHomeDesignPreview(scopeKeys[account]);
  const targetTotal = dashboard.holdings.reduce((sum, row) => sum + (row.targetWeight ?? 0), 0);
  const holdingRows: PortfolioStructureHoldingRow[] = dashboard.holdings.map(row => {
    const target = targetTotal > 0 && row.targetWeight !== null ? (row.targetWeight / targetTotal) * 100 : null;
    const weight = row.valueKrw / dashboard.totalValueKrw * 100;
    return { name: row.name, ticker: row.ticker, account: row.account, market: row.market, currency: row.currency, assetType: row.assetType,
      groupName: row.groupName ?? "미분류", quantity: row.quantity, currentPrice: row.currentPrice, currentValueKrw: row.valueKrw,
      currentWeightPct: weight, rawAssetTargetPct: target, groupTargetPct: null, memberAllocationRatioPct: null,
      effectiveTargetPct: target, driftPct: target === null ? null : weight - target, targetPolicyStatus: "asset_target_raw",
      priceEvidenceSource: "asset_current_price_fallback", priceSource: "sample", priceFetchedAt: null, priceAsOf: null };
  });
  const groupRows: PortfolioStructureGroupRow[] = [...new Set(holdingRows.map(row => row.groupName))].map(name => {
    const rows = holdingRows.filter(row => row.groupName === name);
    return { name, currentValueKrw: rows.reduce((sum, row) => sum + row.currentValueKrw, 0), currentWeightPct: rows.reduce((sum, row) => sum + row.currentWeightPct, 0), groupTargetPct: null, effectiveTargetPct: null, driftPct: null, holdingCount: rows.length, excludedCount: 0 };
  });
  return { account, dashboard, holdingRows, groupRows };
}
