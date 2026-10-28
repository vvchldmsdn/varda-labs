import { resolveKrwFxRate } from "../portfolio-math.ts";
import type { BetaContext, BetaCurrency, FixtureScope } from "./navigation";

// Development examples only. Never import this module as a live-data fallback.
// Synthetic returns and scenario bands are authored examples, not model output.
export const fixtureNotice = "개발용 fixture · 모든 금액·차트·배분은 가상 데이터";
export const fixtureScopes: readonly { key: FixtureScope; label: string; detail: string }[] = [
  { key: "all", label: "전체 자산", detail: "8종목 · 3개 가상 계좌" },
  { key: "fixture-account-a", label: "계좌 A", detail: "VOO · QQQ · MSFT · 가상 계좌" },
  { key: "fixture-long-term", label: "장기 투자", detail: "계좌 A · 계좌 B · 가상 범위" },
];
export const ringColors = ["#ef5a32", "#343932", "#cca17b", "#8c9f89", "#697f8c", "#c98e76", "#9a96a8", "#bbbcaa"];
const holdings = [
  { key: "VOO", name: "Vanguard S&P 500 ETF", weightPct: 24.2, targetPct: 20, account: "A", priceMove: 19300, fxMove: 8300 },
  { key: "QQQ", name: "Invesco QQQ Trust", weightPct: 20, targetPct: 22, account: "A", priceMove: 15700, fxMove: 6700 },
  { key: "SCHD", name: "Schwab US Dividend Equity ETF", weightPct: 14, targetPct: 17, account: "B", priceMove: 9800, fxMove: 3400 },
  { key: "VXUS", name: "Vanguard Total International Stock ETF", weightPct: 12, targetPct: 15, account: "B", priceMove: 10200, fxMove: 2600 },
  { key: "MSFT", name: "Microsoft", weightPct: 10, targetPct: 9, account: "A", priceMove: 23800, fxMove: 2400 },
  { key: "TSM", name: "Taiwan Semiconductor", weightPct: 8, targetPct: 6, account: "B", priceMove: 18400, fxMove: 1800 },
  { key: "GLD", name: "SPDR Gold Shares", weightPct: 6, targetPct: 6, account: "C", priceMove: 900, fxMove: 600 },
  { key: "BND", name: "Vanguard Total Bond Market ETF", weightPct: 5.8, targetPct: 5, account: "C", priceMove: 500, fxMove: 400 },
];
export const heatmapDates = ["09.15", "09.16", "09.17", "09.18", "09.21", "09.22", "09.23", "09.24", "09.25", "09.28", "09.29", "09.30", "10.01", "10.02"];
const priceExamples = [-.43, .7, .96, -.13, 1.25, .32, -.85, -.29, .93, .45, -1.13, .34, .79, .43];

export function getFixtureView(context: BetaContext) {
  const source = context.fixture === "empty" ? [] : holdings.filter((h) => context.scope === "all" ||
    (context.scope === "fixture-account-a" ? h.account === "A" : h.account !== "C"));
  const sourceWeight = source.reduce((sum, h) => sum + h.weightPct, 0);
  const targetWeight = source.reduce((sum, h) => sum + h.targetPct, 0);
  const totalKrw = 33_482_910 * sourceWeight / 100 * (context.fixture === "large" ? 1_000_000 : 1);
  const rows = source.map((h, index) => ({ ...h,
    name: context.fixture === "large" ? `${h.name} · 장기 분산 포트폴리오의 매우 긴 종목명 표시 검증` : h.name,
    weightPct: h.weightPct / sourceWeight * 100,
    targetPct: h.targetPct / targetWeight * 100,
    valueKrw: totalKrw * h.weightPct / sourceWeight,
    color: ringColors[holdings.indexOf(h)],
    heatmap: priceExamples.map((n, day) => (context.fixture === "partial" && (day + index) % 11 === 0) || (h.key === "GLD" && day === 6)
      ? null : Number((n * (1 + index / 9) * (h.key === "GLD" ? -.7 : h.key === "BND" ? -.18 : 1)).toFixed(2))),
  }));
  const history = source.length === 0 ? [] : Array.from({ length: 184 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 3, 2 + i)).toISOString().slice(0, 10);
    const progress = i / 183;
    const valueKrw = totalKrw * (.58 + .42 * progress + .013 * Math.sin(i * 1.23) * (1 - progress));
    return { date, valueKrw: context.fixture === "partial" && i % 23 === 7 ? null : valueKrw,
      exampleReturnPct: context.fixture === "partial" && i % 23 === 7 ? null : progress * 6.8 + .2 * Math.sin(i * .8) * (1 - progress) };
  });
  const priceMoveKrw = source.reduce((sum, h) => sum + h.priceMove, 0);
  const fxMoveKrw = source.reduce((sum, h) => sum + h.fxMove, 0);
  const drift = [...rows].sort((a, b) => Math.abs(b.weightPct - b.targetPct) - Math.abs(a.weightPct - a.targetPct))[0];
  return { rows, totalKrw, history, priceMoveKrw, fxMoveKrw,
    todayMoveKrw: context.fixture === "partial" ? null : priceMoveKrw + fxMoveKrw,
    drift, scopeLabel: fixtureScopes.find((s) => s.key === context.scope)!.label,
    asOf: "2026.10.02 07:00", fxRate: 1400,
    contribution: source.length ? [{ ticker: "QQQ", amountKrw: 700_000 }, { ticker: "SCHD", amountKrw: 400_000 }, { ticker: "VXUS", amountKrw: 400_000 }].filter((r) => source.some((h) => h.key === r.ticker)) : [],
    scenario: source.length ? Array.from({ length: 16 }, (_, i) => ({ middle: i * .34 + Math.sin(i) * .42, spread: i * .55 })) : [],
  };
}
export type FixtureView = import("./read-contract").BetaView;
export type FixtureHolding = FixtureView["rows"][number];

export function displayMoney(krw: number | null, currency: BetaCurrency, signed = false) {
  if (krw === null) return "—";
  const rate = resolveKrwFxRate(currency, 1400);
  const value = rate.ok ? krw / rate.rate : null;
  if (value === null) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: currency === "USD" ? 2 : 0 })}`;
}
