import type { PortfolioTargetBuyability } from "@/lib/portfolio-target-policy";

export type PortfolioTargetEditorRow = Readonly<{
  accountName: string;
  assetName: string;
  market: string;
  currency: string;
  ticker: string | null;
  buyability: PortfolioTargetBuyability;
  currentValueKrw: number | null;
  targetWeightBps: number;
}>;

export function parseDisplayedTargetPercent(value: string) {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return basisPoints <= 10_000 ? basisPoints : null;
}

export function targetInputPercent(basisPoints: number) {
  return (basisPoints / 100).toFixed(2).replace(/\.00$/, "");
}

/** Do not display a partial denominator as a complete current allocation. */
export function currentTargetEditorWeights(rows: readonly PortfolioTargetEditorRow[]) {
  if (rows.length === 0 || rows.some(row => row.currentValueKrw === null || !Number.isFinite(row.currentValueKrw) || row.currentValueKrw < 0)) return rows.map(() => null);
  const total = rows.reduce((sum, row) => sum + row.currentValueKrw!, 0);
  if (!Number.isFinite(total) || total <= 0) return rows.map(() => null);
  return rows.map(row => row.currentValueKrw! / total * 100);
}
