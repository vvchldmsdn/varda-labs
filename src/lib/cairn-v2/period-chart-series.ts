import type { PeriodAttribution } from "./period-attribution";

type Day = PeriodAttribution["days"][number];
export type ImpactBucket = { start: string; end: string; from: number; count: number; price: number | null; fx: number | null; partial: boolean };
type Unit = "day" | "week" | "month";

function bucketKey(date: string, unit: Unit) {
  if (unit === "day") return date;
  if (unit === "month") return date.slice(0, 7);
  const monday = new Date(date + "T00:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

// Bars may cover several calendar days; the valuation line and cursor stay daily.
export function periodChartSeries(days: readonly Day[]) {
  const unit: Unit = days.length <= 31 ? "day" : days.length <= 93 ? "week" : "month";
  const grouped = new Map<string, ImpactBucket>();
  const runs: { index: number; won: number }[][] = [];
  let low: number | null = null, high: number | null = null;
  for (const [index, day] of days.entries()) {
    if (day.closingValueKrw != null) {
      const won = day.closingValueKrw;
      if (index === 0 || days[index - 1].closingValueKrw == null) runs.push([]);
      runs[runs.length - 1].push({ index, won });
      low = low === null ? won : Math.min(low, won);
      high = high === null ? won : Math.max(high, won);
    }
    const key = bucketKey(day.date, unit);
    const bucket = grouped.get(key) ?? { start: day.date, end: day.date, from: index, count: 0, price: null, fx: null, partial: false };
    bucket.count++;
    bucket.end = day.date;
    bucket.partial ||= !day.complete;
    if (day.priceKrw !== null && day.fxKrw !== null) {
      bucket.price = (bucket.price ?? 0) + day.priceKrw;
      bucket.fx = (bucket.fx ?? 0) + day.fxKrw;
    }
    grouped.set(key, bucket);
  }
  return { unit, buckets: [...grouped.values()], runs, low, high };
}
