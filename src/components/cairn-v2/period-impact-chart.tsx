import { useMemo, useState, type PointerEvent } from "react";
import { formatNumber, Input } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import type { PeriodAttribution } from "@/lib/cairn-v2/period-attribution";
import { periodChartSeries } from "@/lib/cairn-v2/period-chart-series";
import styles from "./period-attribution.module.css";
import historyStyles from "./beta.module.css";

export function formatWon(value: number | null, locale: string, signed = true) {
  if (value == null) return "—";
  return formatNumber(value, { maximumFractionDigits: 0, signDisplay: signed ? "exceptZero" : "auto" }) + (locale === "en" ? " KRW" : "원");
}

const shortDate = (date: string) => date.slice(5).replace("-", ".");

export function PeriodImpactChart({ days, selectedDate, onDateChange }: { days: PeriodAttribution["days"]; selectedDate?: string | null; onDateChange?: (date: string) => void }) {
  const { t, locale } = useI18n();
  const { unit, buckets, runs, low, high } = useMemo(() => periodChartSeries(days), [days]);
  const [selected, setSelected] = useState(days.length - 1);
  if (!days.length) return null;
  const matched = selectedDate ? days.findIndex(day => day.date === selectedDate) : -1;
  const index = matched >= 0 ? matched : Math.min(Math.max(selected, 0), days.length - 1);
  function selectDay(next: number) {
    setSelected(next);
    onDateChange?.(days[next].date);
  }
  const day = days[index];
  const bucket = buckets.find(item => index >= item.from && index < item.from + item.count)!;
  const peak = Math.max(0, ...buckets.flatMap(b => [Math.abs(b.price ?? 0), Math.abs(b.fx ?? 0)]));
  const x = (i: number) => (i + .5) * 100 / days.length;
  const y = (value: number) => high === null || low === null || high === low ? 50 : 94 - (value - low) / (high - low) * 88;
  function selectPoint(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width) selectDay(Math.max(0, Math.min(days.length - 1, Math.floor((event.clientX - bounds.left) / bounds.width * days.length))));
  }
  const touch = { onPointerDown: selectPoint, onPointerMove: selectPoint };
  const impactTitle = unit === "day" ? t("일별 가격·환율 영향", "Daily price and FX impact") :
    unit === "week" ? t("주별 가격·환율 영향", "Weekly price and FX impact") : t("월별 가격·환율 영향", "Monthly price and FX impact");
  const valuesTitle = t("보유 종목 평가액", "Holdings value");
  const missing = t("자료 없음", "No record");
  const price = t("가격", "Price");
  const fx = t("환율", "FX");
  const axis = new Intl.NumberFormat(locale === "en" ? "en-US" : "ko-KR", { notation: "compact", maximumFractionDigits: 2 });
  const money = (value: number | null, signed = true) => value == null ? missing : formatWon(value, locale, signed);
  const tick = <i aria-hidden="true" className={styles.cursor} style={{ left: x(index) + "%" }} />;
  const formattedDate = day.date.replaceAll("-", ".");
  const impactStatus = day.priceKrw === null || day.fxKrw === null ? missing : day.complete ? "" : t("일부 종목", "Partial holdings");
  const spoken = [formattedDate, valuesTitle + " " + money(day.closingValueKrw, false), price + " " + money(day.priceKrw), fx + " " + money(day.fxKrw), impactStatus].filter(Boolean).join(" · ");
  return <figure className={styles.chart} data-period-selection data-selected-date={day.date}
    data-selected-period-start={bucket.start} data-selected-period-end={bucket.end}>
    <figcaption className={styles.selection}><time dateTime={day.date}>{formattedDate}</time>
      <span>{t("당일 기록 · 원화", "Daily record · KRW")}</span></figcaption>
    <div className={styles.plotHeading}><strong>{valuesTitle}</strong><span>{money(day.closingValueKrw, false)}</span></div>
    <div className={styles.plot}>
      <div className={styles.valueAxis} aria-hidden="true">{high === low
        ? <span>{high === null ? "" : axis.format(high)}</span>
        : <><span>{axis.format(high!)}</span><span>{axis.format(low!)}</span></>}</div>
      <div className={styles.valueCanvas} {...touch} data-period-valuation-plot role="img" aria-label={valuesTitle}>
        {runs.length ? <>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {runs.filter(run => run.length > 1).map(run => <polyline key={run[0].index} fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
              points={run.map(point => x(point.index) + "," + y(point.won)).join(" ")} />)}
          </svg>
          {runs.filter(run => run.length === 1).map(([point]) => <i key={point.index} className={styles.mark}
            style={{ left: x(point.index) + "%", top: y(point.won) + "%" }} />)}
        </> : <span className={styles.noValues}>{t("이 기간에 저장된 평가액이 없어요.", "No recorded holdings value for this period.")}</span>}
        {tick}
        {day.closingValueKrw != null && <i className={styles.selectedMark}
          style={{ left: x(index) + "%", top: y(day.closingValueKrw) + "%" }} />}
      </div>
    </div>
    <div className={styles.plotHeading}><strong>{impactTitle}</strong><span className={styles.legend}>
      <span data-series="price">{price}</span><span data-series="fx">{fx}</span>
      {buckets.some(b => b.partial) && <span data-series="gap">{t("자료 누락", "Missing records")}</span>}
    </span></div>
    <div className={styles.plot}>
      <div className={styles.axis} aria-hidden="true"><span>{peak ? "+" + axis.format(peak) : ""}</span><span>0</span><span>{peak ? "−" + axis.format(peak) : ""}</span></div>
      <div className={styles.bars} {...touch} data-period-impact-plot role="img" aria-label={impactTitle}>
        {buckets.map(b => <div className={styles.bucket} aria-hidden="true" key={b.start} data-partial={b.partial || undefined}
          data-active={bucket === b || undefined} style={{ flexGrow: b.count }}>
          {(["price","fx"] as const).map(key => {
            const amount = b[key];
            return amount === null || amount === 0 ? null : <i key={key} data-series={key} data-negative={amount < 0 || undefined}
              style={{ height: Math.abs(amount) / peak * 46 + "%" }} />;
          })}
        </div>)}
        {tick}
      </div>
    </div>
    <div className={styles.ticks} aria-hidden="true"><span>{shortDate(days[0].date)}</span>
      {days.length >= 7 && <span>{shortDate(days[Math.floor(days.length / 2)].date)}</span>}
      {days.length > 1 && <span>{shortDate(days[days.length - 1].date)}</span>}</div>
    <div className={styles.probe}>
      {days.length > 1 && <div className={historyStyles.dateSlider}><Input type="range" aria-label={t("그래프 날짜", "Chart date")} min={0} max={days.length - 1} step={1}
        data-period-cursor aria-valuetext={spoken} value={index} onChange={event => selectDay(Number(event.target.value))} /></div>}
      <div className={styles.readout} data-period-readout>
        <span>{t("당일 가격 영향", "Daily price impact")} <strong>{money(day.priceKrw)}</strong></span>
        <span>{t("당일 환율 영향", "Daily FX impact")} <strong>{money(day.fxKrw)}</strong></span>
        {impactStatus && <small>{impactStatus}</small>}
      </div>
      {unit !== "day" && <small className={styles.bucketNote}>{shortDate(bucket.start)} – {shortDate(bucket.end)} · {price} {money(bucket.price)} · {fx} {money(bucket.fx)}
        {bucket.partial && bucket.price !== null && " · " + t("확인 구간 소계", "Confirmed subtotal")}</small>}
    </div>
  </figure>;
}
