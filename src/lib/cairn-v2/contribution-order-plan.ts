import { sizeAdditionalContributionOrders, type OrderSizingAsset } from "../additional-contribution-order-sizing.ts";
import { Decimal, isCurrency, MINOR_DIGITS, moneyMinor, type Currency } from "../money.ts";
import { portfolioStructureHoldingIdentityKey } from "../portfolio-structure-target-policy.ts";
import { isKrxGoldManualAssetCandidate } from "../market-data/manual-asset-price.ts";
import type { ReadyContribution, TargetModel } from "./planning-contract";

export type ContributionOrderKind = "whole" | "fractional-shares" | "fractional-amount";
export const fractionalShareStep = "0.000001";
export type ContributionOrderRule = Readonly<{
  kind: ContributionOrderKind;
  step: string;
  minimum: string;
  fee: string;
  feePct: string;
  minimumFee: string;
  capKrw: string;
}>;
export type ContributionOrderOption = Readonly<{
  key: string;
  label: string;
  accountName: string;
  walletKey: string;
  ticker: string | null;
  market: string | null;
  currency: Currency | null;
  unit: "share" | "gram" | null;
  canBuy: boolean;
  canSell: boolean;
}>;
type BasisRow = Readonly<{
  key: string;
  walletKey: string;
  accountName: string;
  name: string;
  ticker: string | null;
  market: string | null;
  currency: Currency;
  unit: "share" | "gram";
  targetKrw: number;
  maxBuyKrw: number;
  trimKrw: number;
  quantity: number | null;
  price: number;
}>;

export type ContributionOrderBasis = Readonly<{
  budgetKrw: number;
  usdKrw: number | null;
  rows: readonly BasisRow[];
  unavailable: readonly string[];
}>;

export type ContributionOrderSettings = Readonly<{
  useCashLimits: boolean;
  cashByWallet: Readonly<Record<string, string>>;
  rules: Readonly<Record<string, ContributionOrderRule>>;
}>;

export const defaultContributionOrderRule: ContributionOrderRule = {
  kind: "whole", step: "", minimum: "", fee: "", feePct: "", minimumFee: "", capKrw: "",
};
export const defaultContributionOrderSettings: ContributionOrderSettings = {
  useCashLimits: false, cashByWallet: {}, rules: {},
};

export function canUseFractionalOrders(option: ContributionOrderOption) {
  return option.unit === "share" && option.currency !== null && (option.canBuy || option.canSell);
}

export function withFractionalOrders(rule: ContributionOrderRule, enabled: boolean): ContributionOrderRule {
  if (enabled === (rule.kind !== "whole")) return rule;
  return enabled
    ? {...rule, kind: "fractional-shares", step: fractionalShareStep, minimum: "0"}
    : {...rule, kind: "whole", step: "", minimum: ""};
}

function orderUnit(row: Parameters<typeof isKrxGoldManualAssetCandidate>[0]): "share" | "gram" | null {
  if (isKrxGoldManualAssetCandidate(row)) return "gram";
  return row.assetType === "stock" || row.assetType === "etf" ? "share" : null;
}

export function buildContributionOrderOptions(model: TargetModel): ContributionOrderOption[] {
  return model.rows.map(row => ({
    key: row.accountId + ":" + row.assetId, label: row.assetName, accountName: row.accountName,
    ticker: row.ticker, market: row.market, currency: isCurrency(row.currency) ? row.currency : null,
    walletKey: row.accountCode + ":" + row.currency,
    unit: orderUnit({...row, name: row.assetName}), canBuy: row.buyability === "buyable",
    canSell: (row.currentValueKrw ?? 0) > 0,
  }));
}

/** Only the before/after-checked allocation and its admitted price observations enter sizing. */
export function buildContributionOrderBasis(preview: ReadyContribution, model: TargetModel): ContributionOrderBasis {
  const usdKrw = positive(model.structure.usdKrwRate) ? model.structure.usdKrwRate : null;
  const held = new Map(model.structure.holdingRows.map(row => [portfolioStructureHoldingIdentityKey(row), row]));
  const rows: BasisRow[] = [];
  const unavailable: string[] = [];
  for (const row of preview.rows) {
    if (!(row.allocationKrw > 0) && !(row.trimAmountKrw > 0)) continue;
    const identity = portfolioStructureHoldingIdentityKey({ ...row, market: row.market ?? "", currency: row.currency ?? "" });
    const holding = held.get(identity);
    const prices = model.plannedMaRows?.filter(mark => row.ticker !== null && mark.ticker === row.ticker &&
      mark.market === row.market && mark.currency === row.currency &&
      (!mark.accountId || row.allocationKey === mark.accountId + ":" + mark.assetId));
    const price = holding?.currentPrice ?? (prices?.length === 1 ? prices[0].currentPrice : null);
    const unit = orderUnit(row);
    if (!positive(price) || !isCurrency(row.currency) || (row.currency === "USD" && usdKrw === null) ||
      !unit || !row.allocationKey) {
      unavailable.push(row.name);
      continue;
    }
    rows.push({ key: row.allocationKey, walletKey: row.accountCode + ":" + row.currency, accountName: row.accountName,
      name: row.name, ticker: row.ticker, market: row.market, currency: row.currency, unit,
      targetKrw: Math.floor(row.allocationKrw), maxBuyKrw: Math.floor(row.baseNeedKrw),
      trimKrw: row.trimAmountKrw, quantity: holding?.quantity ?? null, price });
  }
  // The strategy can include modelled sales in its funding. Estimated sales
  // must never raise the spend cap for this order projection.
  return {budgetKrw: Math.floor(Math.min(preview.totalAllocatedKrw, preview.cashAmountKrw)), usdKrw, rows, unavailable};
}

export function getContributionWallets(basis: ContributionOrderBasis) {
  return [...new Map(basis.rows.filter(row => row.targetKrw > 0).map(row => [row.walletKey, row])).values()];
}

const projectedSale = (row: BasisRow, usdKrw: number | null, rule: ContributionOrderRule) => {
  if (!(row.trimKrw > 0) || !positive(row.quantity)) return [];
  if (row.unit === "gram" && rule.kind !== "whole") throw Error("invalid_gold_order_unit");
  const priceKrw = Decimal.from(row.price).mul(row.currency === "USD" ? usdKrw! : 1);
  const step = Decimal.from(rule.kind === "whole" ? 1 : fractionalShareStep);
  const heldLots = Decimal.from(row.quantity).div(step).minor("KRW", "floor");
  const plannedLots = Decimal.from(row.trimKrw).div(priceKrw.mul(step)).minor("KRW", "floor");
  const lots = heldLots < plannedLots ? heldLots : plannedLots;
  const quantity = step.mul(new Decimal(lots));
  return lots > BigInt(0) ? [{key: row.key, quantity: quantity.toNumber(), principalKrw: priceKrw.mul(quantity).toNumber()}] : [];
};

function parseOrderTerms(rule: ContributionOrderRule, currency: Currency, unit: BasisRow["unit"]) {
  if (unit === "gram" && rule.kind !== "whole") throw Error("invalid_gold_order_unit");
  const minPrincipalMinor = nativeMinor(rule.minimum, currency);
  const fee = {fixedMinor: nativeMinor(rule.fee, currency), rateBps: nativeMinor(rule.feePct, "USD"),
    minimumMinor: nativeMinor(rule.minimumFee, currency)};
  if (fee.rateBps > 10000) throw Error("invalid_rate");
  const capKrw = rule.capKrw.trim() ? nativeMinor(rule.capKrw, "KRW") : null;
  const terms = {minPrincipalMinor, fee, capKrw};
  if (rule.kind === "whole") return {...terms, kind: rule.kind};
  if (!rule.minimum.trim()) throw Error("invalid_fractional_rule");
  const step = rule.step.trim().replace(/^\./, "0.");
  if (rule.kind === "fractional-shares") {
    if (!/^\d+(?:\.\d{1,8})?$/.test(step) || Decimal.from(step).compare(0) <= 0 || Decimal.from(step).compare(1) >= 0) {
      throw Error("invalid_fractional_rule");
    }
    return {...terms, kind: rule.kind, quantityStep: step};
  }
  if (rule.kind !== "fractional-amount") throw Error("invalid_order_kind");
  const amountStepMinor = nativeMinor(step, currency);
  if (amountStepMinor <= 0) throw Error("invalid_fractional_rule");
  return {...terms, kind: rule.kind, amountStepMinor};
}

export function validContributionOrderRule(rule: ContributionOrderRule, currency: Currency | null, unit: BasisRow["unit"] | null) {
  if (!currency || !unit) return rule.kind === "whole" &&
    ![rule.step, rule.minimum, rule.fee, rule.feePct, rule.minimumFee, rule.capKrw].some(Boolean);
  try {
    parseOrderTerms(rule, currency, unit);
    return true;
  } catch { return false; }
}

export function projectContributionOrderPlan(basis: ContributionOrderBasis, settings: ContributionOrderSettings) {
  let sales: ReturnType<typeof projectedSale> = [];
  const buyRows = basis.rows.filter(row => row.targetKrw > 0);
  const wallets: Record<string, number> = {};
  const assets: OrderSizingAsset[] = [];

  try {
    sales = basis.rows.flatMap(row => projectedSale(row, basis.usdKrw, settings.rules[row.key] ?? defaultContributionOrderRule));
    for (const row of getContributionWallets(basis)) {
      wallets[row.walletKey] = settings.useCashLimits
        ? nativeMinor(settings.cashByWallet[row.walletKey], row.currency)
        : Number(Decimal.from(basis.budgetKrw).div(row.currency === "USD" ? basis.usdKrw! : 1).minor(row.currency, "floor"));
    }
    for (const row of buyRows) {
      const rule = settings.rules[row.key] ?? defaultContributionOrderRule;
      const terms = parseOrderTerms(rule, row.currency, row.unit);
      let order: OrderSizingAsset["order"];
      switch (terms.kind) {
        case "whole":
          order = {kind: terms.kind, unitPrice: row.price};
          break;
        case "fractional-shares":
          order = {kind: terms.kind, unitPrice: row.price, quantityStep: terms.quantityStep};
          break;
        case "fractional-amount":
          order = {kind: terms.kind, amountStepMinor: terms.amountStepMinor};
          break;
      }
      assets.push({key: row.key, currency: row.currency, walletKey: row.walletKey, targetKrw: row.targetKrw,
        krwPerCurrency: row.currency === "USD" ? basis.usdKrw! : 1, maxPrincipalKrw: Math.min(row.maxBuyKrw, terms.capKrw ?? basis.budgetKrw, basis.budgetKrw),
        fee: terms.fee, minPrincipalMinor: terms.minPrincipalMinor, order});
    }

    const result = sizeAdditionalContributionOrders({budgetKrw:basis.budgetKrw, wallets, assets});
    if (result.status !== "unavailable" || result.reason !== "no_feasible_combination") return {status:"ready" as const, result, sales, relaxed:false};
    const optional = assets.map(asset => asset.order.kind === "whole" ? {...asset,order:{...asset.order,allowLower:true}} : asset);
    return {status:"ready" as const, result:sizeAdditionalContributionOrders({budgetKrw:basis.budgetKrw, wallets, assets:optional}), sales, relaxed:true};
  } catch {
    return {status:"invalid" as const, result:null, sales, relaxed:false};
  }
}

export function displayOrderNativeAmount(minor: number, currency: Currency) {
  return (minor / 10 ** MINOR_DIGITS[currency]).toLocaleString(currency === "KRW" ? "ko-KR" : "en-US", {minimumFractionDigits: MINOR_DIGITS[currency]});
}

export function validContributionWalletAmount(raw: string | undefined, currency: Currency) {
  try {
    nativeMinor(raw, currency);
    return true;
  } catch { return false; }
}

function nativeMinor(raw: string | undefined, currency: Currency) {
  if (!raw?.trim()) return 0;
  const rawNumber = raw.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(rawNumber) || rawNumber.length > 18) throw Error("invalid_amount");
  const minor = moneyMinor(rawNumber, currency);
  if (minor > 10_000_000_000_000) throw Error("invalid_amount");
  return minor;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
