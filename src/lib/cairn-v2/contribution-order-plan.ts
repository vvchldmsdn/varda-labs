import { sizeAdditionalContributionOrders, type OrderSizingAsset } from "../additional-contribution-order-sizing.ts";
import { Decimal, isCurrency, MINOR_DIGITS, moneyMinor, type Currency } from "../money.ts";
import { portfolioStructureHoldingIdentityKey } from "../portfolio-structure-target-policy.ts";
import { isKrxGoldManualAssetCandidate } from "../market-data/manual-asset-price.ts";
import type { ReadyContribution, TargetModel } from "./planning-contract";

export type ContributionOrderKind = "whole" | "fractional-shares" | "fractional-amount";
export type ContributionOrderRule = Readonly<{
  kind: ContributionOrderKind;
  step: string;
  minimum: string;
  fee: string;
  feePct: string;
  minimumFee: string;
  capKrw: string;
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
    const prices = model.plannedMaRows?.filter(mark => row.ticker !== null && mark.ticker === row.ticker && mark.market === row.market && mark.currency === row.currency);
    const price = holding?.currentPrice ?? (prices?.length === 1 ? prices[0].currentPrice : null);
    const gold = isKrxGoldManualAssetCandidate(row);
    if (!positive(price) || !isCurrency(row.currency) || (row.currency === "USD" && usdKrw === null) ||
      (!gold && !["stock", "etf"].includes(row.assetType ?? "")) || !row.allocationKey) {
      unavailable.push(row.name);
      continue;
    }
    rows.push({ key: row.allocationKey, walletKey: row.accountCode + ":" + row.currency, accountName: row.accountName,
      name: row.name, ticker: row.ticker, market: row.market, currency: row.currency, unit: gold ? "gram" : "share",
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

const projectedSale = (row: BasisRow, usdKrw: number | null) => {
  if (!(row.trimKrw > 0) || !positive(row.quantity)) return [];
  const priceKrw = Decimal.from(row.price).mul(row.currency === "USD" ? usdKrw! : 1);
  const quantity = Math.min(Math.floor(row.quantity), Number(Decimal.from(row.trimKrw).div(priceKrw).minor("KRW", "floor")));
  return quantity > 0 ? [{key: row.key, quantity, principalKrw: priceKrw.mul(quantity).toNumber()}] : [];
};

export function projectContributionOrderPlan(basis: ContributionOrderBasis, settings: ContributionOrderSettings) {
  const sales = basis.rows.flatMap(row => projectedSale(row, basis.usdKrw));
  const buyRows = basis.rows.filter(row => row.targetKrw > 0);
  const wallets: Record<string, number> = {};
  const assets: OrderSizingAsset[] = [];

  try {
    for (const row of getContributionWallets(basis)) {
      wallets[row.walletKey] = settings.useCashLimits
        ? nativeMinor(settings.cashByWallet[row.walletKey], row.currency)
        : Number(Decimal.from(basis.budgetKrw).div(row.currency === "USD" ? basis.usdKrw! : 1).minor(row.currency, "floor"));
    }
    for (const row of buyRows) {
      const rule = settings.rules[row.key] ?? defaultContributionOrderRule;
      if (row.unit === "gram" && rule.kind !== "whole") throw Error("invalid_gold_order_unit");
      const minPrincipalMinor = nativeMinor(rule.minimum, row.currency);
      const fee = {fixedMinor: nativeMinor(rule.fee, row.currency), rateBps: nativeMinor(rule.feePct, "USD"), minimumMinor: nativeMinor(rule.minimumFee, row.currency)};
      if (fee.rateBps > 10000) throw Error("invalid_rate");
      const pricing = {unitPrice: row.price};
      const step = rule.step.trim().replace(/^\./, "0.");
      let order: OrderSizingAsset["order"];
      switch (rule.kind) {
        case "whole":
          order = {kind: rule.kind, ...pricing};
          break;
        case "fractional-shares":
          if (!/^\d+(?:\.\d{1,8})?$/.test(step) || Decimal.from(step).compare(0) <= 0 || Decimal.from(step).compare(1) >= 0 || !rule.minimum.trim()) throw Error("invalid_fractional_rule");
          order = {kind: rule.kind, ...pricing, quantityStep: step};
          break;
        case "fractional-amount": {
          const amountStepMinor = nativeMinor(step, row.currency);
          if (amountStepMinor <= 0 || !rule.minimum.trim()) throw Error("invalid_fractional_rule");
          order = {kind: rule.kind, amountStepMinor};
          break;
        }
      }
      const customMax = rule.capKrw.trim() ? nativeMinor(rule.capKrw, "KRW") : basis.budgetKrw;
      assets.push({key: row.key, currency: row.currency, walletKey: row.walletKey, targetKrw: row.targetKrw,
        krwPerCurrency: row.currency === "USD" ? basis.usdKrw! : 1, maxPrincipalKrw: Math.min(row.maxBuyKrw, customMax, basis.budgetKrw),
        fee, minPrincipalMinor, order});
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
