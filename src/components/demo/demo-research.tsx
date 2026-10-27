"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { PublicProductDemo } from "@/lib/public-product-demo";
import styles from "./demo.module.css";
import { useI18n } from "@/components/i18n/locale-provider";
function ChartLoading() { const {t}=useI18n(); return <p role="status">{t("차트를 준비하고 있어요…","Preparing the chart…")}</p>; }
const Charts = dynamic(() => import("@/components/first-visit/product-demo-charts"), { ssr: false, loading: ChartLoading });
export function DemoResearch({ view }: { view: "lab" | "simulation" }) {
  const {t}=useI18n();
  const [horizon, setHorizon] = useState<63 | 126>(63);
  const [period, setPeriod] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data: PublicProductDemo } | null>(null);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState("");
  const key = `${view}:${horizon}:${retry}`;
  const chartData = useMemo(() => {
    const data = loaded?.data;
    if (!data || data.kind !== "lab" || period === 0) return data;
    const lines = data.chart.lines.map(line => ({ ...line, points: line.points.slice(-period) }));
    const points = lines[0]?.points ?? [];
    return { ...data, chart: { ...data.chart, lines, period: points.length ? { startServiceDate: points[0].serviceDate, endServiceDate: points.at(-1)!.serviceDate, comparisonDateCount: points.length } : null } };
  }, [loaded, period]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/public-demo?view=${view}&horizon=${horizon}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("unavailable");
      return response.json() as Promise<PublicProductDemo>;
    }).then(data => { if (!controller.signal.aborted) setLoaded({ key, data }); }).catch(() => { if (!controller.signal.aborted) setFailed(key); });
    return () => controller.abort();
  }, [key, view, horizon]);
  return <div className={styles.research} data-demo-ready={loaded?.key === key ? "true" : "false"}>
    <p className={styles.explanation}>{view === "lab" ? t("비교할 전략을 바꾸고, 날짜를 짚어 차이를 살펴보세요.","Change strategies and select a date to compare them.") : t("기간을 바꾸고 1,000개 경로와 결과 분포를 직접 탐색해보세요.","Change the horizon and explore 1,000 paths and their distribution.")}</p>
    <p className={styles.disclaimer}>{view === "lab" ? t("비교 전용 가상 포트폴리오·가상 수익률입니다. 실제 과거 투자 성과가 아닙니다.","Illustrative portfolios and returns for comparison; these are not actual investment results.") : t("확률 계산 전용 예시 자산·가상 과거 시세입니다. 수익률을 보장하거나 미래를 예측하지 않습니다.","Illustrative assets and prices for probability calculations. These do not guarantee returns or predict the future.")}</p>
    {view === "simulation" ? <label className={styles.period}>{t("계산 기간","Horizon")}<select className="cairn-form-select" value={horizon} onChange={event => setHorizon(Number(event.target.value) as 63 | 126)}><option value={63}>{t("63 거래 단계","63 trading steps")}</option><option value={126}>{t("126 거래 단계","126 trading steps")}</option></select></label> : null}
    {view === "lab" ? <label className={styles.period}>{t("표시 구간","Display period")}<select className="cairn-form-select" value={period} onChange={event => setPeriod(Number(event.target.value))}><option value={0}>{t("전체 기록","All records")}</option><option value={90}>{t("최근 90개 기록","Last 90 records")}</option><option value={30}>{t("최근 30개 기록","Last 30 records")}</option></select></label> : null}
    {loaded?.key === key && chartData ? <Charts key={key} data={chartData}/> : failed === key ? <div role="alert"><p>{t("샘플을 불러오지 못했어요.","Could not load the example.")}</p><button className="cairn-secondary" onClick={() => setRetry(value => value + 1)}>{t("다시 불러오기","Try again")}</button></div> : <div className={styles.loading} role="status">{view === "simulation" ? t("가능한 경로를 계산하고 있어요…","Calculating possible paths…") : t("비교 화면을 준비하고 있어요…","Preparing the comparison…")}</div>}
  </div>;
}
