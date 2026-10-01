import type { DailyPortfolioSnapshot, DailyPositionSnapshot } from "../../db/schema.ts";
import { Decimal } from "../money.ts";
import { nativeCostAmounts, type NativePortfolioState, type NativePosition } from "../native-portfolio-ledger.ts";

export type HoldingsRevisionRebuildInput = {
  portfolio: DailyPortfolioSnapshot;
  positions: readonly DailyPositionSnapshot[];
  /** The caller resolves effective revisions at the original policy boundary. */
  state: NativePortfolioState;
  revision: number;
  /** Historical evidence admitted by the caller at this exact snapshot/cutoff. Never live quotes. */
  positionTemplates?: readonly DailyPositionSnapshot[];
  assets?: readonly { id: string; maAssetClass?: string | null }[];
};
export type HoldingsRevisionRebuildResult =
  | { status: "ready"; portfolio: DailyPortfolioSnapshot; positions: DailyPositionSnapshot[] }
  | { status: "blocked"; reason: string; assetIds: string[] };

/** Rebuild holdings only. Native cash, current quotes and current acquisition FX
 * cannot become historical valuation evidence. Inputs are never modified. */
export function buildHoldingsRevisionSnapshot(input: HoldingsRevisionRebuildInput): HoldingsRevisionRebuildResult {
  try { return rebuild(input); }
  catch { return blocked("invalid_revision_snapshot_evidence"); }
}

/** Rebuild an existing all-account row only from its complete validated member
 * set. Member capture times may differ, as in the original daily aggregate. */
export function buildHoldingsRevisionAggregate(
  originalPortfolio: DailyPortfolioSnapshot,
  validAccountPortfolios: readonly DailyPortfolioSnapshot[],
  revision: number,
): { status: "ready"; portfolio: DailyPortfolioSnapshot } | Extract<HoldingsRevisionRebuildResult, { status: "blocked" }> {
  try {
    const original = originalPortfolio, members = validAccountPortfolios;
    const counts = (original.description ?? "").split(";").map(tag => tag.trim()).filter(tag => tag.startsWith("accounts="));
    const expected = counts.length === 1 && /^accounts=[1-9]\d*$/.test(counts[0]) ? Number(counts[0].slice(9)) : NaN;
    if (original.account !== "all" || original.accountId !== null || !original.canonicalOwnerUserId || original.isSample ||
        !Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(expected) || expected !== members.length ||
        new Set(members.map(row => row.accountId)).size !== members.length || new Set(members.map(row => row.account)).size !== members.length ||
        members.some(row => row.account === "all" || !row.accountId || row.isSample || row.snapshotDate !== original.snapshotDate ||
          row.source !== original.source || row.canonicalOwnerUserId !== original.canonicalOwnerUserId ||
          !(row.description ?? "").split(";").some(tag => tag.trim() === "snapshot_status=complete"))) {
      return blocked("revision_aggregate_members_incomplete");
    }
    const values = members.map(row => nonnegative(row.totalMarketValue));
    if (values.some(value => value === null)) return blocked("invalid_revision_snapshot_evidence");
    const total = sum(values as Decimal[], value => value);
    const cost = completeSum(members.map(row => nonnegative(row.totalCost)));
    const pnl = completeSum(members.map(row => row.totalPnl === null ? null : Decimal.from(row.totalPnl)));
    const count = (key: "numAssets" | "numGroups") => members.every(row => Number.isSafeInteger(row[key]) && row[key]! >= 0)
      ? members.reduce((sum, row) => sum + row[key]!, 0) : null;
    const weighted = (key: "krWeight" | "usWeight" | "usdExposurePct" | "thematicWeight") => {
      const weights = members.map(row => nonnegative(row[key]));
      if (weights.some(value => value === null || value.compare(100) > 0)) return null;
      const amount = weights.reduce<Decimal>((sum, value, index) => sum.add(value!.mul(values[index]!).div(100)), Decimal.from(0));
      return percent(amount, total);
    };
    return { status: "ready", portfolio: {
      ...original, cashValue: "0", totalMarketValue: stored(total), investedAmount: stored(cost), totalCost: stored(cost), totalPnl: stored(pnl), totalReturnPct: null,
      numAssets: count("numAssets"), numGroups: count("numGroups"),
      krWeight: weighted("krWeight"), usWeight: weighted("usWeight"), usdExposurePct: weighted("usdExposurePct"), thematicWeight: weighted("thematicWeight"),
      topHoldingName: null, topHoldingWeight: null,
      avgCorrelation: null, enb: null, portfolioVolatility: null, regimeLabel: null, regimeScore: null,
      description: tags(original.description, ["snapshot_status", "native_revision", "accounts", "return_basis", "open_cost_krw", "realized_pnl_krw", "realized_cost_basis_krw", "realized_sell_events", "revision_rebuild"], [
        "snapshot_status=complete", `accounts=${members.length}`, `native_revision=${revision}`, "revision_rebuild=holdings_at_original_cutoff",
        "return_basis=open_unrealized_only_realized_unavailable", `open_cost_krw=${stored(cost) ?? "unknown"}`,
        "realized_pnl_krw=unknown", "realized_cost_basis_krw=unknown", "realized_sell_events=unknown",
      ]),
    } };
  } catch { return blocked("invalid_revision_snapshot_evidence"); }
}

function rebuild({ portfolio, positions, state, revision, positionTemplates = [], assets = [] }: HoldingsRevisionRebuildInput): HoldingsRevisionRebuildResult {
  const cutoff = timestamp(portfolio.cycleEndAt);
  const executionCollection = (portfolio.description ?? "").split(";").some(tag => tag.trim() === "valuation_policy=execution_collection_v1");
  const stateAt = Date.parse(state.at);
  if (!portfolio.canonicalOwnerUserId || !portfolio.accountId || portfolio.account === "all" || portfolio.isSample ||
      state.accountId !== portfolio.accountId || !Number.isSafeInteger(revision) || revision < 0 ||
      !Number.isFinite(cutoff) || !Number.isFinite(stateAt) || (executionCollection ? stateAt > cutoff : stateAt >= cutoff)) {
    return blocked("revision_snapshot_scope_mismatch");
  }
  const inScope = (row: DailyPositionSnapshot) => !row.isSample && row.canonicalOwnerUserId === portfolio.canonicalOwnerUserId &&
    row.accountId === portfolio.accountId && row.account === portfolio.account && row.snapshotDate === portfolio.snapshotDate &&
    row.source === portfolio.source && timestamp(row.cycleEndAt) === cutoff;
  if (positions.some(row => !inScope(row)) || positionTemplates.some(row => !inScope(row))) return blocked("revision_snapshot_scope_mismatch");
  if (portfolio.numAssets !== null && portfolio.numAssets !== positions.length) return blocked("revision_snapshot_positions_incomplete");
  if (new Set(positions.map(identity)).size !== positions.length || new Set(state.positions.map(row => row.assetId)).size !== state.positions.length ||
      new Set(positionTemplates.map(identity)).size !== positionTemplates.length) return blocked("revision_snapshot_identity_duplicate");
  const native = new Map(state.positions.map(row => [row.assetId, row]));
  const original = new Map(positions.map(row => [row.assetId, row]));
  const templates = new Map(positionTemplates.map(row => [row.assetId, row]));
  const rebuilt: DailyPositionSnapshot[] = [];

  for (const row of positions) {
    if (manual(row)) {
      if (nonnegative(row.marketValueKrw) === null) return blocked("invalid_revision_snapshot_evidence", row.assetId);
      rebuilt.push({ ...row, ...withoutMovement(), description: positionDescription(row.description, revision, "preserved_manual_evidence") });
      continue;
    }
    if (!row.assetId) return blocked("revision_snapshot_identity_missing");
    const result = rebuildPosition(row, native.get(row.assetId), portfolio, revision);
    if (result.status === "blocked") return result;
    if (result.position) rebuilt.push(result.position);
  }
  for (const position of state.positions) {
    if (nonnegative(position.quantity) === null) return blocked("invalid_revision_snapshot_evidence", position.assetId);
    if (Decimal.from(position.quantity).compare(0) === 0 || original.has(position.assetId)) continue;
    const template = templates.get(position.assetId);
    if (!template || manual(template)) return blocked("missing_revision_price_evidence", position.assetId);
    const result = rebuildPosition(template, position, portfolio, revision);
    if (result.status === "blocked") return result;
    if (result.position) rebuilt.push(result.position);
  }

  const total = sum(rebuilt, row => nonnegative(row.marketValueKrw)!);
  const cost = completeSum(rebuilt.map(row => nonnegative(row.costKrw)));
  const pnl = cost === null ? null : total.sub(cost);
  const thematicByAsset = new Map(assets.map(asset => [asset.id, asset.maAssetClass]));
  const thematicKnown = rebuilt.every(row => row.assetId !== null && thematicByAsset.has(row.assetId));
  const thematic = thematicKnown ? sum(rebuilt.filter(row => thematicByAsset.get(row.assetId!) === "thematic"), row => Decimal.from(row.marketValueKrw!)) : null;
  const top = [...rebuilt].sort((a, b) => Decimal.from(b.marketValueKrw!).compare(a.marketValueKrw!) || identity(a).localeCompare(identity(b)))[0];
  const weighted = rebuilt.map(row => ({ ...row, currentWeight: percent(Decimal.from(row.marketValueKrw!), total), driftPct: null }));
  return {
    status: "ready",
    positions: weighted,
    portfolio: {
      ...portfolio,
      cashValue: "0",
      investedAmount: stored(cost), totalCost: stored(cost), totalMarketValue: stored(total), totalPnl: stored(pnl),
      // Native remaining lots do not prove cumulative realized profit or time returns.
      totalReturnPct: null,
      numAssets: rebuilt.length,
      numGroups: new Set(rebuilt.map(row => row.legacyGroupId ?? row.groupName).filter(Boolean)).size,
      topHoldingName: top?.assetName ?? null,
      topHoldingWeight: top ? percent(Decimal.from(top.marketValueKrw!), total) : null,
      krWeight: percent(sum(rebuilt.filter(row => row.market === "korea"), row => Decimal.from(row.marketValueKrw!)), total),
      usWeight: percent(sum(rebuilt.filter(row => row.market === "us"), row => Decimal.from(row.marketValueKrw!)), total),
      usdExposurePct: percent(sum(rebuilt, row => Decimal.from(row.marketValueKrw!).mul(row.exposureType === "US_LISTED" ? 1 : row.exposureType === "KR_UNHEDGED_GLOBAL" ? "0.5" : 0)), total),
      thematicWeight: thematic === null ? null : percent(thematic, total),
      avgCorrelation: null, enb: null, portfolioVolatility: null, regimeLabel: null, regimeScore: null,
      description: tags(portfolio.description, ["native_revision", "expected_positions", "return_basis", "open_cost_krw", "realized_pnl_krw", "realized_cost_basis_krw", "realized_sell_events", "revision_rebuild"], [
        `native_revision=${revision}`, `expected_positions=${rebuilt.length}`, "revision_rebuild=holdings_at_original_cutoff",
        "return_basis=open_unrealized_only_realized_unavailable", `open_cost_krw=${stored(cost) ?? "unknown"}`,
        "realized_pnl_krw=unknown", "realized_cost_basis_krw=unknown", "realized_sell_events=unknown",
      ]),
    },
  };
}

function rebuildPosition(row: DailyPositionSnapshot, position: NativePosition | undefined, portfolio: DailyPortfolioSnapshot, revision: number):
  { status: "ready"; position: DailyPositionSnapshot | null } | Extract<HoldingsRevisionRebuildResult, { status: "blocked" }> {
  const quantity = nonnegative(position?.quantity ?? "0");
  const fractional = nonnegative(row.fractionalKrwValue ?? "0");
  if (quantity === null || fractional === null || (position && position.currency !== row.currency)) return blocked("invalid_revision_snapshot_evidence", row.assetId);
  if (quantity.compare(0) === 0 && fractional.compare(0) === 0) return { status: "ready", position: null };
  const price = nonnegative(row.unitPrice ?? row.currentPrice ?? row.closePrice);
  const fx = row.currency === "KRW" ? Decimal.from(1) : row.currency === "USD" ? nonnegative(row.fxRate ?? portfolio.usdKrw ?? portfolio.fxRate) : null;
  if (quantity.compare(0) > 0 && (price === null || price.compare(0) <= 0 || fx === null || fx.compare(0) <= 0 || !row.priceSource || !row.priceBasis)) {
    return blocked("missing_revision_price_evidence", row.assetId);
  }
  const value = quantity.compare(0) > 0 ? quantity.mul(price!).mul(fx!).add(fractional) : fractional;
  const nativeCost = quantity.compare(0) === 0 ? Decimal.from(0) : remainingKrwCost(position!);
  const fractionalCost = fractional.compare(0) > 0 ? nonnegative(row.fractionalAvgCost) : Decimal.from(0);
  const cost = nativeCost === null || fractionalCost === null ? null : nativeCost.add(fractionalCost);
  const pnl = cost === null ? null : value.sub(cost);
  return { status: "ready", position: {
    ...row, ...withoutMovement(),
    quantity: stored(quantity, 8), totalQuantity: stored(quantity, 8), estimatedFractionalQuantity: fractional.compare(0) > 0 ? null : "0",
    avgCost: row.currency === "KRW" && nativeCost !== null && quantity.compare(0) > 0 ? stored(nativeCost.div(quantity)) : null,
    unitValueKrw: price !== null && fx !== null ? stored(price.mul(fx)) : null,
    marketValueKrw: stored(value), marketValueLocal: fx !== null && fx.compare(0) > 0 ? stored(value.div(fx)) : null,
    costKrw: stored(cost), pnlKrw: stored(pnl), pnlPct: cost !== null && cost.compare(0) > 0 && pnl !== null ? percent(pnl, cost) : null,
    description: positionDescription(row.description, revision, cost === null ? "unknown" : "native_remaining_cost"),
  } };
}

function remainingKrwCost(position: NativePosition): Decimal | null {
  const lots = nativeCostAmounts(position.costLots);
  if (lots === null || lots.some(lot => lot.currency !== "KRW")) return null;
  return lots.reduce((value, lot) => value.add(lot.amount), Decimal.from(0));
}
function withoutMovement() {
  return { previousFxRate: null, previousQuantity: null, previousUnitPrice: null, previousUnitValueKrw: null, previousMarketValueKrw: null,
    priceChangeKrw: null, fxChangeKrw: null, marketValueChangeKrw: null, marketValueChangePct: null, unitValueChangeKrw: null,
    unitValueChangePct: null, previousReferenceDate: null, previousSnapshotDate: null };
}
function positionDescription(value: string | null, revision: number, basis: string) {
  return tags(value, ["native_revision", "cost_basis_source", "movement_attribution"], [`native_revision=${revision}`, `cost_basis_source=${basis}`, "movement_attribution=revision_rebuild_unavailable"]);
}
function tags(value: string | null, replaced: string[], append: string[]) {
  return [...(value ?? "").split(";").map(part => part.trim()).filter(part => part && !replaced.includes(part.split("=")[0])), ...append].join("; ");
}
function manual(row: DailyPositionSnapshot) { return !row.ticker?.trim() || row.sourceType === "manual"; }
function identity(row: DailyPositionSnapshot) { return row.assetId ?? row.legacyAssetId ?? row.id; }
function timestamp(value: Date | string | null) { return value === null ? NaN : new Date(value).getTime(); }
function nonnegative(value: string | null): Decimal | null {
  if (value === null) return null;
  const parsed = Decimal.from(value);
  return parsed.compare(0) < 0 ? null : parsed;
}
function sum<T>(rows: readonly T[], select: (row: T) => Decimal) { return rows.reduce((total, row) => total.add(select(row)), Decimal.from(0)); }
function completeSum(values: (Decimal | null)[]) { return values.some(value => value === null) ? null : sum(values as Decimal[], value => value); }
function percent(value: Decimal, total: Decimal) { return total.compare(0) > 0 ? stored(value.div(total).mul(100)) : "0"; }
/** Match the snapshot numeric(…, 6/8) storage boundary, with exact rational rounding. */
function stored(value: Decimal | null, digits = 6): string | null {
  if (value === null) return null;
  const scale = BigInt(10) ** BigInt(digits), n = value.n * scale, q = n / value.d, remainder = n % value.d;
  const rounded = q + ((remainder < 0 ? -remainder : remainder) * BigInt(2) >= value.d ? (n < 0 ? -BigInt(1) : BigInt(1)) : BigInt(0));
  return new Decimal(rounded, scale).toExactString();
}
function blocked(reason: string, assetId?: string | null): Extract<HoldingsRevisionRebuildResult, { status: "blocked" }> {
  return { status: "blocked", reason, assetIds: assetId ? [assetId] : [] };
}
