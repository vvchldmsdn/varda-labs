import type { SimulationReturnMatrixResult } from "./shared-domain/simulation-return-matrix-types";

export type FirstDayReplay = { state: "ready"; coveragePct: number; excluded: string[]; dates: string[]; points: number[]; changePct: number; rows: { name: string; weightPct: number; returns: number[] }[] } | { state: "unavailable"; reason: "valuation" | "history" | "read" };
/** Frozen starting weights + buy-and-hold. No daily rebalancing, cash flows or personal P&L. */
export function buildFirstDayReplay(matrix: SimulationReturnMatrixResult | null, holdings: readonly { instrumentKey: string; name: string; weightBps: number | null }[], extraExcluded: readonly string[] = []): FirstDayReplay {
  if (!matrix || matrix.status !== "ready" || matrix.policy.priceField !== "adjusted_close_price_only" || matrix.matrix.length < 2 || holdings.some(row => row.weightBps === null)) return { state: "unavailable", reason: "history" };
  const included = matrix.instruments.map(instrument => holdings.find(row => row.instrumentKey === instrument.instrumentKey));
  if (included.some(row => !row || !Number.isFinite(row.weightBps) || row.weightBps! <= 0)) return { state: "unavailable", reason: "valuation" };
  const basket = included.filter((row): row is NonNullable<typeof row> => !!row);
  const total = basket.reduce((sum, row) => sum + row.weightBps!, 0);
  if (total <= 0 || total > 10000) return { state: "unavailable", reason: "valuation" };
  const paths = basket.map(() => 1), points = [100];
  const rows = basket.map(row => ({ name: row.name, weightPct: row.weightBps! / total * 100, returns: [] as number[] }));
  const dates = [matrix.matrix[0].previousServiceDate];
  for (const day of matrix.matrix) {
    if (day.previousServiceDate !== dates.at(-1) || day.serviceDate <= day.previousServiceDate) return { state: "unavailable", reason: "history" };
    for (let index = 0; index < basket.length; index++) {
      const matches = day.cells.filter(cell => cell.instrumentKey === basket[index].instrumentKey);
      const cell = matches[0];
      if (matches.length !== 1 || cell.value === null || !Number.isFinite(cell.value) || cell.value <= -1 || cell.previous.status !== "ready" || cell.current.status !== "ready") return { state: "unavailable", reason: "history" };
      paths[index] *= 1 + cell.value;
      rows[index].returns.push(cell.value * 100);
    }
    const value = paths.reduce((sum, value, index) => sum + value * basket[index].weightBps! / total, 0) * 100;
    if (!Number.isFinite(value)) return { state: "unavailable", reason: "history" };
    dates.push(day.serviceDate); points.push(value);
  }
  return { state: "ready", coveragePct: total / 100, excluded: [...extraExcluded, ...holdings.filter(row => !basket.includes(row)).map(row => row.name)], dates, points, changePct: points.at(-1)! - 100, rows };
}
