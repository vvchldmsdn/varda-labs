import assert from "node:assert/strict";
import { test } from "node:test";
import { sizeAdditionalContributionOrders as size } from "../src/lib/additional-contribution-order-sizing.ts";

const buy = (key, targetKrw, order, extra = {}) => ({
  key, targetKrw, maxPrincipalKrw: 1_000_000_000, walletKey: "won", currency: "KRW",
  fee: { fixedMinor: 0 }, order, ...extra,
});
const whole = (key, target, price, extra, allowOmit) => buy(key, target, { kind: "whole", unitPrice: price, allowOmit }, extra);
const fractional = (key, target, step, extra) => buy(key, target, { kind: "fractional-amount", amountStepMinor: step }, extra);
const shares = (key, target, price, step, extra) => buy(key, target, { kind: "fractional-shares", unitPrice: price, quantityStep: step }, extra);
const run = (budgetKrw, assets, wallets = { won: budgetKrw }) => size({ budgetKrw, wallets, assets });
const quantities = result => result.orders.map(order => order.quantity);
const principal = result => result.orders.map(order => order.principalKrw);

test("reaches the 1M investment target with the smallest allocation error", () => {
  const result = run(1_000_000, [whole("a", 200_000, 180_000), whole("b", 300_000, 250_000),
    shares("c", 500_000, 600_000, "0.01")]);
  assert.equal(result.status, "exact");
  assert.deepEqual(quantities(result), ["1", "1", "0.95"]);
  assert.equal(result.principalKrw, 1_000_000);
  assert.equal(result.allocationErrorKrw, 140_000);
});

test("coarse fractional steps obey a tighter asset ceiling", () => {
  const inputs = [whole("a", 200_000, 180_000), whole("b", 300_000, 250_000),
    shares("c", 500_000, 600_000, "0.1")];
  const unrestricted = run(1_000_000, inputs);
  assert.deepEqual(quantities(unrestricted), ["1", "2", "0.5"]);
  assert.equal(unrestricted.principalKrw, 980_000);
  const capped = run(1_000_000, [inputs[0], { ...inputs[1], maxPrincipalKrw: 350_000 }, inputs[2]]);
  assert.equal(capped.status, "exact");
  assert.deepEqual(quantities(capped), ["1", "1", "0.9"]);
  assert.equal(capped.principalKrw, 970_000);
  assert.equal(capped.allocationErrorKrw, 110_000);
});

test("couples independent fractional steps to find a fill that greedy misses", () => {
  const result = run(100_000, [whole("a", 61_000, 61_000),
    fractional("b", 20_000, 6_000, { minPrincipalMinor: 12_000 }),
    fractional("c", 19_000, 5_000, { minPrincipalMinor: 10_000 })]);
  assert.equal(result.status, "exact");
  assert.deepEqual(principal(result), [61_000, 24_000, 15_000]);
  assert.equal(result.remainingKrw, 0);
});

test("counts fees in the cap without maximizing fees, and leaves a below-minimum balance", () => {
  const fee = { fixedMinor: 1_000 };
  const result = run(100_000, [whole("a", 60_000, 58_000, { fee }),
    fractional("b", 40_000, 1_000, { fee, minPrincipalMinor: 20_000 })]);
  assert.deepEqual([result.principalKrw, result.feesKrw, result.spentKrw, result.remainingKrw], [98_000, 2_000, 100_000, 0]);
  const belowMinimum = run(100_000, [whole("a", 55_000, 54_000, { fee }),
    fractional("b", 45_000, 5_000, { fee, minPrincipalMinor: 50_000 })]);
  assert.deepEqual(principal(belowMinimum), [54_000, 0]);
  assert.equal(belowMinimum.remainingKrw, 45_000);
  const sameSpend = run(50_000, [whole("a", 25_000, 47_000, { fee: { fixedMinor: 3_000 } }),
    whole("b", 25_000, 48_000, { fee: { fixedMinor: 2_000 } })]);
  assert.deepEqual(principal(sameSpend), [0, 48_000]);
});

test("distinguishes cash wallets in equal-reporting-spend states", () => {
  const dollar = { currency: "USD", walletKey: "usd", krwPerCurrency: 100, maxPrincipalKrw: 3 };
  const result = run(10, [fractional("initial-krw", 6, 3, { maxPrincipalKrw: 6 }),
    fractional("usd", 0, 3, dollar), fractional("remaining-krw", 4, 1, { maxPrincipalKrw: 4 })], { won: 7, usd: 3 });
  assert.equal(result.status, "exact");
  assert.deepEqual(principal(result), [3, 3, 4]);
  assert.equal(result.remainingKrw, 0);
});

test("requires explicit permission to consider omitting a whole-share floor", () => {
  const fee = { fixedMinor: 1_000 };
  const absent = run(100_000, [whole("a", 50_000, 50_000, { fee }), whole("b", 50_000, 50_000, { fee })]);
  assert.deepEqual(absent, { status: "unavailable", reason: "no_feasible_combination" });
  const allowed = run(100_000, [whole("a", 50_000, 50_000, { fee }, true),
    whole("b", 50_000, 50_000, { fee }, true)]);
  assert.equal(allowed.status, "exact");
  assert.equal(allowed.principalKrw, 50_000);
  assert.equal(allowed.remainingKrw, 49_000);
});

test("a cash-limited retry can buy below the original floor and respects native fees and original upper quantity", () => {
  const target = [whole("a", 1_000_000, 100_000, { fee: { fixedMinor: 10_000 } })];
  const smallWallet = { won: 250_000 };
  assert.equal(run(1_000_000, target, smallWallet).status, "unavailable");
  const allowed = target.map(asset => ({ ...asset, order: { ...asset.order, allowLower: true } }));
  const result = run(1_000_000, allowed, smallWallet);
  assert.equal(result.status, "exact");
  assert.deepEqual(quantities(result), ["2"]);
  assert.equal(result.principalKrw, 200_000);
  assert.equal(result.orders[0].spentMinor, 210_000);
  const underTarget = { ...allowed[0], targetKrw: 120_000 };
  assert.deepEqual(quantities(run(1_000_000, [underTarget])), ["2"]);
});

test("large equal amount grids and a single fine share grid have bounded exact paths", () => {
  const uniform = run(10_000_000_000, [fractional("a", 1_000_000_000, 1, { maxPrincipalKrw: 9_000_000_000 }),
    fractional("b", 9_000_000_000, 1, { maxPrincipalKrw: 9_000_000_000 })]);
  assert.equal(uniform.status, "exact");
  assert.deepEqual(principal(uniform), [1_000_000_000, 9_000_000_000]);
  const single = run(10_000_000_000, [shares("a", 10_000_000_000, "10.77", "0.000001", { maxPrincipalKrw: 10_000_000_000 })]);
  assert.equal(single.status, "exact");
  assert.equal(single.principalKrw, 10_000_000_000);
});

test("rounds estimated FX and settlement conservatively, and refuses unknown or conflicting commitment evidence", () => {
  const foreign = { currency: "USD", walletKey: "usd", krwPerCurrency: "1300.01", fee: { fixedMinor: 1 } };
  const feasible = run(29, [shares("a", 14, "9.99", "0.001", foreign)], { usd: 3 });
  assert.deepEqual([feasible.status, feasible.principalKrw, feasible.feesKrw, feasible.orders[0].spentMinor], ["exact", 14, 14, 2]);
  const oneCent = run(29, [shares("a", 14, "9.99", "0.001", foreign)], { usd: 1 });
  assert.deepEqual([oneCent.status, oneCent.principalKrw], ["exact", 0]);
  assert.deepEqual(run(29, [shares("a", 14, "10.05", "0.001", { ...foreign, krwPerCurrency: undefined })], { usd: 3 }),
    { status: "unavailable", reason: "invalid_input" });
  assert.deepEqual(run(29, [fractional("a", 0, 1), fractional("a", 1, 1)]),
    { status: "unavailable", reason: "invalid_input" });
  assert.deepEqual(run(29, [fractional("a", 0, 1), shares("b", 14, 10, 0.1, { ...foreign, walletKey: "won" })]),
    { status: "unavailable", reason: "invalid_input" });
});

test("matches exhaustive search on small mixed portfolios, including capped uniform amount grids", () => {
  let seed = 7;
  function integer(max) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % max;
  }
  for (let trial = 0; trial < 200; trial++) {
    const budget = 15 + integer(20);
    const multipleWallets = trial % 2 === 0;
    const uniform = trial % 4 === 1;
    const wallets = multipleWallets ? { won: budget - 8, usd: 8 } : { won: budget };
    const assets = Array.from({ length: 4 }, (_, index) => {
      const quote = multipleWallets && integer(2) === 0 ? { walletKey: "usd", currency: "USD", krwPerCurrency: 100 } : {};
      const extra = {
        ...quote,
        maxPrincipalKrw: 5 + integer(26),
        minPrincipalMinor: uniform ? 0 : integer(2) * integer(10),
        fee: { fixedMinor: uniform ? 0 : integer(4), rateBps: uniform ? 0 : 100 * integer(3) },
      };
      const target = integer(budget);
      if (index < 2 && !uniform && integer(2)) {
        const asset = whole(String(index), target, 2 + integer(9), extra, integer(3) === 0);
        return { ...asset, order: { ...asset.order, allowLower: integer(4) === 0 } };
      }
      return fractional(String(index), target, uniform ? 2 : 2 + integer(9), extra);
    });
    let expected = null;
    function search(index, used, invested, expense, error) {
      if (expense > budget || Object.keys(used).some(key => used[key] > wallets[key])) return;
      if (index >= assets.length) {
        if (!expected || invested > expected[0] || invested === expected[0] &&
          (error < expected[1] || error === expected[1] && expense < expected[2])) expected = [invested, error, expense];
        return;
      }
      const { order, targetKrw, walletKey, currency, maxPrincipalKrw, minPrincipalMinor, fee } = assets[index];
      const step = order.kind === "whole" ? order.unitPrice * (currency === "USD" ? 100 : 1) : order.amountStepMinor;
      for (let amount = 0; amount <= Math.min(maxPrincipalKrw, budget - expense); amount += step) {
        if (amount > 0 && amount < minPrincipalMinor) continue;
        if (order.kind === "whole" && order.allowLower && amount > Math.ceil(targetKrw / step) * step) continue;
        if (order.kind === "whole" && !order.allowLower && (amount > 0 || !order.allowOmit) &&
          amount !== Math.floor(targetKrw / step) * step && amount !== Math.ceil(targetKrw / step) * step) continue;
        const cost = amount ? amount + fee.fixedMinor + Math.ceil(amount * fee.rateBps / 10_000) : 0;
        search(index + 1, { ...used, [walletKey]: (used[walletKey] ?? 0) + cost },
          invested + amount, expense + cost, error + Math.abs(amount - targetKrw));
      }
    }
    search(0, {}, 0, 0, 0);
    const result = run(budget, assets, wallets);
    if (expected === null) assert.equal(result.status, "unavailable", JSON.stringify({ trial, budget, wallets, assets, result }));
    else {
      assert.equal(result.status, "exact", String(trial));
      assert.deepEqual([result.principalKrw, result.allocationErrorKrw, result.spentKrw], expected, String(trial));
    }
  }
});

test("enforces spending constraints in the deterministic bounded-search fallback", () => {
  const result = run(1_000_000, [fractional("a", 600_000, 1, { maxPrincipalKrw: 600_000, fee: { fixedMinor: 15 } }),
    fractional("b", 400_000, 1, { maxPrincipalKrw: 400_000, fee: { fixedMinor: 20 } })]);
  assert.equal(result.status, "approximate");
  assert.equal(result.reason, "search_limit");
  assert.equal(result.principalKrw + result.feesKrw + result.remainingKrw, 1_000_000);
  assert.equal(result.spentKrw, 1_000_000);
  assert.ok(result.orders[0].principalKrw <= 600_000 && result.orders[1].principalKrw <= 400_000);
});
