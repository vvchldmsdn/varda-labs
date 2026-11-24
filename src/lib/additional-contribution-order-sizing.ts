import { Decimal, isCurrency, MINOR_DIGITS, type Currency } from "./money.ts";

type OrderSize =
  | { kind: "whole"; unitPrice: number | string; allowOmit?: boolean; allowLower?: boolean }
  | { kind: "fractional-shares"; unitPrice: number | string; quantityStep: number | string }
  | { kind: "fractional-amount"; amountStepMinor: number };

export type OrderSizingAsset = {
  key: string;
  targetKrw: number;
  maxPrincipalKrw: number;
  walletKey: string;
  currency: Currency;
  krwPerCurrency?: number | string;
  fee: { fixedMinor: number; rateBps?: number; minimumMinor?: number };
  minPrincipalMinor?: number;
  order: OrderSize;
};

export type SizedContributionOrder = {
  key: string;
  walletKey: string;
  currency: Currency;
  quantity: string | null;
  principalMinor: number;
  feeMinor: number;
  spentMinor: number;
  principalKrw: number;
  feeKrw: number;
  spentKrw: number;
};

type SizingInput = {
  budgetKrw: number;
  /** Available funds by independent settlement wallet, in its own minor units. */
  wallets: Readonly<Record<string, number>>;
  assets: readonly OrderSizingAsset[];
};

type SizingSummary = {
  orders: SizedContributionOrder[];
  principalKrw: number;
  feesKrw: number;
  spentKrw: number;
  remainingKrw: number;
  allocationErrorKrw: number;
};

export type OrderSizingResult =
  | ({ status: "exact" } & SizingSummary)
  | ({ status: "approximate"; reason: "search_limit" } & SizingSummary)
  | { status: "unavailable"; reason: "invalid_input" | "no_feasible_combination" };

type Quote = Omit<SizedContributionOrder, "quantity" | "key" | "walletKey" | "currency"> & { lots: bigint };
type PreparedAsset = {
  asset: OrderSizingAsset;
  wallet: number;
  quantityStep: Decimal | null;
  wholeOptions: Quote[] | null;
  minLots: bigint;
  maxLots: bigint;
  quote: (lots: bigint) => Quote;
};
type Selection = { before: Selection | null; index: number; quote: Quote };
type State = {
  used: number[];
  spent: number;
  principal: number;
  error: number;
  selected: Selection | null;
};

const MAX_INPUT = 100_000_000_000;
const MAX_ASSETS = 100;
const MAX_STATES = 8_000;
const MAX_TRANSITIONS = 90_000;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const BPS = BigInt(10_000);
const ceil = (n: bigint, d: bigint) => (n + d - ONE) / d;
const minimum = (a: bigint, b: bigint) => a < b ? a : b;
const money = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_INPUT;

function positive(value: number | string | undefined) {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("missing_decimal");
  const parsed = Decimal.from(value);
  if (parsed.compare(0) <= 0 || parsed.compare(MAX_INPUT) > 0) throw new Error("invalid_decimal");
  return parsed;
}

function prepare(asset: OrderSizingAsset, wallet: number, availableMinor: number, budgetKrw: number): PreparedAsset {
  if (!money(asset.targetKrw) || !money(asset.maxPrincipalKrw) || !isCurrency(asset.currency) ||
    !money(asset.minPrincipalMinor ?? 0) || !money(asset.fee?.fixedMinor) || !money(asset.fee.minimumMinor ?? 0) ||
    !money(asset.fee.rateBps ?? 0) || (asset.fee.rateBps ?? 0) > 10_000) throw new Error("invalid_asset");
  const rate = asset.currency === "KRW" ? Decimal.from(1) : positive(asset.krwPerCurrency);
  if (asset.currency === "KRW" && asset.krwPerCurrency !== undefined && positive(asset.krwPerCurrency).compare(1) !== 0)
    throw new Error("invalid_krw_rate");
  const factor = 10 ** MINOR_DIGITS[asset.currency];
  const krwPerMinor = rate.div(factor);
  let quantityStep: Decimal | null;
  let lotMinor: Decimal;
  switch (asset.order?.kind) {
    case "whole":
      quantityStep = Decimal.from(1);
      lotMinor = positive(asset.order.unitPrice).mul(factor);
      break;
    case "fractional-shares":
      quantityStep = positive(asset.order.quantityStep);
      if (quantityStep.compare(1) >= 0 || quantityStep.compare("0.00000001") < 0) throw new Error("invalid_quantity_step");
      lotMinor = positive(asset.order.unitPrice).mul(quantityStep).mul(factor);
      break;
    case "fractional-amount":
      if (!money(asset.order.amountStepMinor) || !asset.order.amountStepMinor) throw new Error("invalid_amount_step");
      quantityStep = null;
      lotMinor = Decimal.from(asset.order.amountStepMinor);
      break;
    default:
      throw new Error("invalid_order_kind");
  }
  const converted = (amount: bigint) => Number(ceil(amount * krwPerMinor.n, krwPerMinor.d));
  const flat = BigInt(asset.fee.fixedMinor), minimumFee = BigInt(asset.fee.minimumMinor ?? 0);
  const rateBps = BigInt(asset.fee.rateBps ?? 0);
  function quote(lots: bigint): Quote {
    const principal = ceil(lots * lotMinor.n, lotMinor.d);
    const calculated = flat + ceil(principal * rateBps, BPS);
    const fee = lots === ZERO ? ZERO : calculated >= minimumFee ? calculated : minimumFee;
    const principalKrw = converted(principal), feeKrw = converted(fee);
    return { lots, principalMinor: Number(principal), feeMinor: Number(fee), spentMinor: Number(principal + fee),
      principalKrw, feeKrw, spentKrw: principalKrw + feeKrw };
  }
  const maxKrw = BigInt(Math.min(budgetKrw, asset.maxPrincipalKrw));
  const nativeLimit = minimum(BigInt(availableMinor), (maxKrw * krwPerMinor.d) / krwPerMinor.n);
  let maxLots = (nativeLimit * lotMinor.d) / lotMinor.n;
  const minNative = BigInt(Math.max(1, asset.minPrincipalMinor ?? 0));
  const minLots = ((minNative - ONE) * lotMinor.d) / lotMinor.n + ONE;
  let wholeOptions: Quote[] | null = null;
  if (asset.order.kind === "whole") {
    const lotKrw = lotMinor.mul(krwPerMinor);
    const target = BigInt(asset.targetKrw) * lotKrw.d;
    const upper = ceil(target, lotKrw.n);
    if (asset.order.allowLower) {
      // An explicit cash-limited retry can consider fewer lots from the same
      // recommendation. Its upper quantity and policy cap still apply.
      maxLots = minimum(maxLots, upper);
    } else {
      const eligible = new Set([target / lotKrw.n, upper]);
      if (asset.order.allowOmit) eligible.add(ZERO);
      wholeOptions = [...eligible].filter(lots => lots === ZERO || lots >= minLots && lots <= maxLots)
        .map(quote).sort((a, b) => a.spentMinor - b.spentMinor);
    }
  }
  return { asset, wallet, quantityStep, wholeOptions, minLots, maxLots, quote };
}

function admissible(state: State, asset: PreparedAsset, quote: Quote, budgetKrw: number, limits: number[]) {
  return state.spent + quote.spentKrw <= budgetKrw && state.used[asset.wallet] + quote.spentMinor <= limits[asset.wallet];
}

function add(state: State, asset: PreparedAsset, quote: Quote, index: number): State {
  const used = [...state.used];
  used[asset.wallet] += quote.spentMinor;
  return { used, spent: state.spent + quote.spentKrw, principal: state.principal + quote.principalKrw,
    error: state.error + Math.abs(quote.principalKrw - asset.asset.targetKrw),
    selected: { before: state.selected, index, quote } };
}

/** Invested principal first, then original allocation, then lower estimated charges. */
function better(a: State, b: State) {
  return a.principal > b.principal || a.principal === b.principal &&
    (a.error < b.error || a.error === b.error && a.spent < b.spent);
}

function highestAffordable(state: State, asset: PreparedAsset, budgetKrw: number, limits: number[]): Quote {
  let lower = asset.minLots, upper = asset.maxLots;
  let best = asset.quote(ZERO);
  while (lower <= upper) {
    const middle = (lower + upper) / BigInt(2);
    const guess = asset.quote(middle);
    if (admissible(state, asset, guess, budgetKrw, limits)) {
      best = guess;
      lower = middle + ONE;
    } else {
      upper = middle - ONE;
    }
  }
  // A small converted step can share a rounded principal with a cheaper order.
  if (best.lots > asset.minLots && asset.quote(best.lots - ONE).principalKrw === best.principalKrw) {
    lower = asset.minLots;
    upper = best.lots - ONE;
    while (lower <= upper) {
      const middle = (lower + upper) / BigInt(2);
      const guess = asset.quote(middle);
      if (guess.principalKrw === best.principalKrw) {
        best = guess;
        upper = middle - ONE;
      } else {
        lower = middle + ONE;
      }
    }
  }
  return best;
}

function* candidates(asset: PreparedAsset): Generator<Quote> {
  if (asset.wholeOptions) {
    yield* asset.wholeOptions;
    return;
  }
  yield asset.quote(ZERO);
  for (let lots = asset.minLots; lots <= asset.maxLots; lots += ONE) yield asset.quote(lots);
}

/** Fallback starts with the cost-minimal valid combination, then spends only verified residual cash. */
function fallback(assets: PreparedAsset[], start: State, budgetKrw: number, limits: number[]) {
  const selected: Quote[] = [];
  let totals = start;
  for (const [index, asset] of assets.entries()) {
    const quote = asset.wholeOptions ? asset.wholeOptions[0] : asset.quote(ZERO);
    if (!quote || !admissible(totals, asset, quote, budgetKrw, limits)) return null;
    selected.push(quote);
    totals = add(totals, asset, quote, index);
  }
  const ranked = assets.map((asset, index) => ({ asset, index }))
    .sort((a, b) => b.asset.asset.targetKrw - a.asset.asset.targetKrw);
  for (const { asset, index } of ranked) {
    const old = selected[index];
    const spent = totals.spent - old.spentKrw;
    const used = [...totals.used];
    used[asset.wallet] -= old.spentMinor;
    const without = {
      spent, used, selected: null, principal: totals.principal - old.principalKrw,
      error: totals.error - Math.abs(old.principalKrw - asset.asset.targetKrw),
    };
    const quote = asset.wholeOptions
      ? asset.wholeOptions.findLast(candidate => admissible(without, asset, candidate, budgetKrw, limits))
      : highestAffordable(without, asset, budgetKrw, limits);
    if (!quote) continue;
    selected[index] = quote;
    totals = add(without, asset, quote, index);
  }
  return selected.reduce((state, quote, index) => add(state, assets[index], quote, index), start);
}

function uniformAmountGroup(assets: PreparedAsset[], fractional: number[]) {
  if (fractional.length < 2) return null;
  const base = assets[fractional[0]];
  const order = base.asset.order;
  if (order.kind !== "fractional-amount" || base.asset.currency !== "KRW") return null;
  const step = order.amountStepMinor;
  const admitted = fractional.every(index => {
    const { asset, wallet } = assets[index];
    return asset.currency === "KRW" && wallet === base.wallet && asset.order.kind === "fractional-amount" &&
      asset.order.amountStepMinor === step && (asset.minPrincipalMinor ?? 0) <= step &&
      !asset.fee.fixedMinor && !asset.fee.rateBps && !asset.fee.minimumMinor;
  });
  if (!admitted) return null;
  const members = fractional.map(index => {
    const { asset, maxLots } = assets[index];
    const target = Math.floor(asset.targetKrw / step);
    return {
      index, capacity: Number(maxLots), underTarget: Math.min(Number(maxLots), target),
      remainder: asset.targetKrw % step,
    };
  });
  const crossing = members.filter(item => item.remainder > 0 && item.capacity > item.underTarget)
    .sort((a, b) => b.remainder - a.remainder);
  return { members, crossing, step, wallet: base.wallet };
}

function fillUniformAmounts(group: NonNullable<ReturnType<typeof uniformAmountGroup>>, assets: PreparedAsset[],
  state: State, budgetKrw: number, limits: number[]) {
  let left = Math.floor(Math.min(budgetKrw - state.spent, limits[group.wallet] - state.used[group.wallet]) / group.step);
  const units = new Map<number, number>();
  for (const item of group.members) {
    const amount = Math.min(left, item.underTarget);
    units.set(item.index, amount);
    left -= amount;
  }
  // Equal-size increments have the same budget cost. The benefit for the
  // first step crossing a target depends on its remainder; later steps tie.
  for (const item of group.crossing) {
    if (!left) break;
    units.set(item.index, item.underTarget + 1);
    left--;
  }
  for (const item of group.members) {
    const already = units.get(item.index)!;
    const extra = Math.min(left, item.capacity - already);
    units.set(item.index, already + extra);
    left -= extra;
  }
  return group.members.reduce((row, { index }) => add(row, assets[index], assets[index].quote(BigInt(units.get(index)!)), index), state);
}

function optimize(assets: PreparedAsset[], start: State, budgetKrw: number, limits: number[]) {
  // With all other choices fixed, the largest affordable order in the last
  // ranged asset maximizes principal, so do not enumerate it.
  const sequence = assets.map((_, index) => index);
  const ranged = sequence.filter(index => assets[index].wholeOptions === null);
  const group = uniformAmountGroup(assets, ranged);
  const last = ranged.reduce((best, index) => best < 0 || assets[index].maxLots > assets[best].maxLots ? index : best, -1);
  const direct = new Set(group ? ranged : [last]);
  let transitions = 0;
  let frontier = [start];
  for (const index of sequence.filter(index => !direct.has(index))) {
    const asset = assets[index];
    const merged = new Map<string, State>();
    for (const quote of candidates(asset)) {
      for (const state of frontier) {
        if (++transitions > MAX_TRANSITIONS) return { limited: true, state: null };
        if (!admissible(state, asset, quote, budgetKrw, limits)) continue;
        const attainable = add(state, asset, quote, index);
        // Equal KRW spend alone cannot represent independent settlement cash.
        const key = attainable.spent + ":" + attainable.used.join(",");
        const previous = merged.get(key);
        if (!previous || better(attainable, previous)) merged.set(key, attainable);
        if (merged.size > MAX_STATES) return { limited: true, state: null };
      }
    }
    frontier = [...merged.values()];
    if (!frontier.length) return { limited: false, state: null };
  }
  let best: State | null = null;
  for (const state of frontier) {
    const row = group ? fillUniformAmounts(group, assets, state, budgetKrw, limits)
      : last < 0 ? state : add(state, assets[last], highestAffordable(state, assets[last], budgetKrw, limits), last);
    if (!best || better(row, best)) best = row;
  }
  return { limited: false, state: best };
}

export function sizeAdditionalContributionOrders(input: SizingInput): OrderSizingResult {
  if (!money(input.budgetKrw) || !input.wallets || !Array.isArray(input.assets) || input.assets.length > MAX_ASSETS)
    return { status: "unavailable", reason: "invalid_input" };
  const wallets = new Map<string, { index: number; currency: Currency }>();
  const keys = new Set<string>();
  const limits: number[] = [];
  let assets: PreparedAsset[];
  try {
    assets = input.assets.map(asset => {
      if (!asset.key?.trim() || keys.has(asset.key) || !asset.walletKey?.trim() ||
        !Object.hasOwn(input.wallets, asset.walletKey) || !money(input.wallets[asset.walletKey])) throw new Error("invalid_wallet");
      keys.add(asset.key);
      const availableMinor = input.wallets[asset.walletKey];
      const known = wallets.get(asset.walletKey);
      if (known && known.currency !== asset.currency) throw new Error("wallet_currency_mismatch");
      const index = known?.index ?? limits.length;
      if (!known) {
        wallets.set(asset.walletKey, { index, currency: asset.currency });
        limits.push(availableMinor);
      }
      return prepare(asset, index, availableMinor, input.budgetKrw);
    });
  } catch {
    return { status: "unavailable", reason: "invalid_input" };
  }
  const start: State = { used: limits.map(() => 0), spent: 0, principal: 0, error: 0, selected: null };
  const optimized = optimize(assets, start, input.budgetKrw, limits);
  const state = optimized.limited ? fallback(assets, start, input.budgetKrw, limits) : optimized.state;
  if (!state) return { status: "unavailable", reason: "no_feasible_combination" };
  const orders: SizedContributionOrder[] = [];
  for (let selection = state.selected; selection; selection = selection.before) {
    const { index, quote } = selection;
    const { asset, quantityStep } = assets[index];
    const { lots, ...cost } = quote;
    orders[index] = { ...cost, key: asset.key, currency: asset.currency, walletKey: asset.walletKey,
      quantity: quantityStep ? quantityStep.mul(new Decimal(lots)).toExactString() : null };
  }
  const summary = { orders, principalKrw: state.principal, feesKrw: state.spent - state.principal,
    spentKrw: state.spent, remainingKrw: input.budgetKrw - state.spent, allocationErrorKrw: state.error };
  return optimized.limited ? { ...summary, status: "approximate", reason: "search_limit" } : { ...summary, status: "exact" };
}
