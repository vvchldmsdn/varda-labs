import { useI18n } from "@/components/i18n/locale-provider";
import { formatNumber } from "@/components/cairn-ui";
import type { PeriodAttribution } from "@/lib/cairn-v2/period-attribution";
import styles from "./period-attribution.module.css";

export function formatWon(value: number | null, locale: string) {
  if (value === null) return "—";
  return formatNumber(value, { maximumFractionDigits: 0, signDisplay: "exceptZero" }) + (locale === "en" ? " KRW" : "원");
}

type Granularity = "day" | "week" | "month";
type Bucket = { start: string; end: string; price: number | null; fx: number | null; partial: boolean };

function bucketKey(date: string, unit: Granularity) {
  if (unit === "day") return date;
  if (unit === "month") return date.slice(0, 7);
  const monday = new Date(date + "T00:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

function chartBuckets(days: PeriodAttribution["days"], unit: Granularity) {
  const buckets = new Map<string, Bucket>();
  for (const day of days) {
    const key = bucketKey(day.date, unit);
    const bucket = buckets.get(key) ?? { start: day.date, end: day.date, price: null, fx: null, partial: false };
    bucket.end = day.date;
    bucket.partial ||= !day.complete;
    if (day.priceKrw !== null && day.fxKrw !== null) {
      bucket.price = (bucket.price ?? 0) + day.priceKrw;
      bucket.fx = (bucket.fx ?? 0) + day.fxKrw;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}

export function PeriodImpactChart({ days }: { days: PeriodAttribution["days"] }) {
  const { t, locale } = useI18n();
  const unit = days.length <= 31 ? "day" : days.length <= 93 ? "week" : "month";
  const buckets = chartBuckets(days, unit);
  if (!buckets.length) return null;
  const peak = Math.max(0, ...buckets.flatMap(b => [Math.abs(b.price ?? 0), Math.abs(b.fx ?? 0)]));
  const label = unit === "day" ? t("일별 가격·환율 영향", "Daily price and FX impact") :
    unit === "week" ? t("주별 가격·환율 영향", "Weekly price and FX impact") : t("월별 가격·환율 영향", "Monthly price and FX impact");
  const price = t("가격", "Price");
  const fx = t("환율", "FX");
  const gap = t("자료 누락", "Missing records");
  const axis = new Intl.NumberFormat(locale === "en" ? "en-US" : "ko-KR", { notation: "compact", maximumFractionDigits: 1 });
  return <figure className={styles.chart}>
    <figcaption><strong>{label}</strong><span className={styles.legend}>
      <span data-series="price">{price}</span><span data-series="fx">{fx}</span>
      {buckets.some(bucket => bucket.partial) && <span data-series="gap">{gap}</span>}
    </span></figcaption>
    <div className={styles.plot} role="img" aria-label={label}>
      <div className={styles.axis} aria-hidden="true"><span>{peak ? "+" + axis.format(peak) : ""}</span><span>0</span><span>{peak ? "−" + axis.format(peak) : ""}</span></div>
      <div className={styles.bars} aria-hidden="true">
        {buckets.map(b => <div className={styles.bucket} key={b.start} data-partial={b.partial || undefined}
          title={[b.start === b.end ? b.start : b.start + " – " + b.end, price + " " + formatWon(b.price, locale), fx + " " + formatWon(b.fx, locale), b.partial ? gap : ""].filter(Boolean).join(" · ")}>
          {(["price","fx"] as const).map(key => {
            const amount = b[key];
            return amount === null || amount === 0 ? null : <i key={key} data-series={key} data-negative={amount < 0 || undefined}
              style={{ height: Math.abs(amount) / peak * 50 + "%" }} />;
          })}
        </div>)}
      </div>
    </div>
    <div className={styles.ticks} aria-hidden="true"><span>{buckets[0].start.slice(5).replace("-", ".")}</span>
      {buckets[0].start !== buckets.at(-1)?.end && <span>{buckets.at(-1)?.end.slice(5).replace("-", ".")}</span>}</div>
  </figure>;
}
