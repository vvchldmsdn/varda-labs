"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SimulationPathDetail, SimulationPathHandle } from "@/lib/simulation-path-detail";
import { useSimulationText } from "./simulation-text";
import styles from "./simulation-path-detail.module.css";

export default function SimulationPathDetailPanel({ handle, pathIndex, step, onStep, onClose }: {
  handle: SimulationPathHandle; pathIndex: number; step: number; onStep: (step: number) => void; onClose: () => void;
}) {
  const t = useSimulationText();
  const title = useId();
  const close = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<SimulationPathDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/simulation/path-detail", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, pathIndex }), signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}));
          throw new Error(problem.error === "execution_preparing" ? "preparing" : problem.error === "unsupported_version" ? "version" : problem.error === "detail_corrupt" ? "corrupt" : response.status === 404 ? "missing" : response.status === 410 || response.status === 409 ? "expired" : response.status === 401 ? "session" : "unavailable");
        }
        const data = await response.json() as SimulationPathDetail;
        if (data.executionId !== handle.executionId || data.pathIndex !== pathIndex || data.currency !== handle.currency || data.model !== handle.model) throw new Error("expired");
        if (!controller.signal.aborted) setResult(data);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason.message ?? "unavailable"); });
    return () => controller.abort();
  }, [handle, pathIndex, attempt]);
  const current = result ? Math.max(0, Math.min(result.horizon, Math.round(step))) : 0;
  const format = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const signed = (value: number) => `${value > 0 ? "+" : ""}${format(value)}`;
  const draw = result?.draws.find(row => row.step === current);
  return <section className={styles.panel} role="region" aria-labelledby={title} data-simulation-path-detail onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header><div><p>{t("같은 경로 안의 변화", "Changes within this path")}</p><h3 id={title}>{t(`선택 경로 #${pathIndex + 1}`, `Selected path #${pathIndex + 1}`)}</h3></div><button ref={close} type="button" onClick={onClose} aria-label={t("경로 설명 닫기", "Close path details")}><X size={20} /></button></header>
    {error ? <div role="alert" className={styles.message}><p>{error === "expired" ? t("이 실행이 만료됐어요. 화면을 새로고침한 뒤 경로를 다시 선택해 주세요.", "This execution expired. Refresh the page and select a path again.") : error === "preparing" ? t("경로 설명을 준비하고 있어요. 잠시 후 다시 시도해 주세요.", "Details are still being prepared. Retry shortly.") : error === "missing" ? t("이 실행은 더 이상 열 수 없어요. 새로 계산해 주세요.", "This execution is no longer available. Calculate a new one.") : error === "corrupt" ? t("저장된 경로를 확인할 수 없어요. 새로 계산해 주세요.", "The saved path could not be verified. Calculate a new one.") : error === "version" ? t("이 실행의 상세 형식은 현재 지원하지 않습니다.", "This execution uses an unsupported detail format.") : error === "session" ? t("로그인 상태를 확인한 뒤 다시 열어 주세요.", "Check your sign-in and reopen the details.") : t("경로 설명을 불러오지 못했어요.", "Path details could not be loaded.")}</p>{["expired", "missing", "corrupt", "version"].includes(error) ? <button type="button" onClick={() => window.location.reload()}>{t("새로 계산", "Calculate again")}</button> : <button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>{t("다시 시도", "Retry")}</button>}</div> : !result ? <p role="status" className={styles.message}>{t("선택한 경로를 불러오는 중…", "Loading the selected path…")}</p> : <>
      <div className={styles.timeline}><label htmlFor={`${title}-step`}>{t("선택 시점", "Selected step")} <strong>{current} / {result.horizon}</strong></label><input id={`${title}-step`} type="range" min={0} max={result.horizon} value={current} onChange={event => onStep(Number(event.target.value))} /></div>
      <p className={styles.caption}>{result.currency} · {t("시작값 100 기준 · 실제 금액 아님", "Start = 100 · Not a cash valuation")}</p>
      <dl className={styles.summary}>{[[t("시작", "Start"), format(result.portfolio[0])], [t("선택 시점", "Selected"), format(result.portfolio[current])], [t("종료", "End"), format(result.portfolio.at(-1)!)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className={styles.metrics}>{t("최종 수익률", "Final return")} <strong>{signed(result.finalReturnPct)}%</strong><span>{t("최대 낙폭", "Max drawdown")} <strong>{format(result.maxDrawdownPct)}%</strong></span></p>
      {result.factors.length > 0 ? <section className={styles.section}><h4>{t("경제 상태", "Economic state")}</h4><p className={styles.caption}>{t("출발값은 관측치, 이후는 이 경로의 모형 값입니다. 인과관계를 뜻하지 않습니다.", "Observed starting values; simulated states thereafter. These do not establish causation.")}</p><div className={styles.table}><div className={styles.row}><span>{t("지표", "Factor")}</span><span>{t("시작", "Start")}</span><span>{t("선택", "Selected")}</span><span>{t("종료", "End")}</span></div>{result.factors.map(factor => <div className={styles.row} key={factor.key}><span>{factor.key === "usdkrw" ? "USD/KRW" : factor.key === "us_10y_yield" ? t("미국 10년 금리", "US 10Y yield") : t("미국 장단기 금리차", "US 10Y–2Y spread")}<small>{factor.unit} · {factor.observationDate}</small></span><span>{format(factor.values[0])}</span><span>{format(factor.values[current])}</span><span>{format(factor.values.at(-1)!)}</span></div>)}</div></section> : null}
      {result.model === "bootstrap" ? <section className={styles.section}><h4>{t("실제로 뽑은 과거 구간", "Actual historical draw")}</h4><p className={styles.caption}>{draw ? `${draw.from} → ${draw.to} · ${draw.blockStart ? t("새 블록", "New block") : t("이어진 블록", "Continuing block")}` : t("시작 시점에는 추출한 수익률이 없습니다.", "No return is drawn at step zero.")}</p></section> : null}
      <section className={styles.section}><h4>{t("종목별 변화", "Holding changes")}</h4><p className={styles.caption}>{t(`보유 평가액의 ${format(result.coveragePct)}% 포함 · 포함된 종목만 100으로 시작`, `${format(result.coveragePct)}% of holdings covered · Modeled holdings start at 100`)}<br />{t("현금·제외 자산은 별도입니다. 환율은 수익률에 이미 반영돼 있습니다.", "Cash and excluded assets are outside this path. Returns already include FX.")}</p><div className={styles.table}><div className={styles.row}><span>{t("종목", "Holding")}</span><span>{t("시작", "Start")}</span><span>{t("선택", "Selected")}</span><span>{t("종료", "End")}</span></div>{result.assets.map(asset => <div className={styles.asset} key={asset.key}><div className={styles.row}><span>{asset.label}</span><span>{format(asset.values[0])}</span><span>{format(asset.values[current])}</span><span>{format(asset.values.at(-1)!)}</span></div><p>{t("종료 기여", "Final contribution")} {signed(asset.values.at(-1)! - asset.values[0])} pp · {t("선택 단계 변화", "Selected step return")} {asset.returns[current] === null ? "—" : `${signed(asset.returns[current]! * 100)}%`}</p></div>)}</div></section>
      <details className={styles.provenance}><summary>{t("계산 근거", "Calculation evidence")}</summary><p>{t("초기 비중 × 해당 경로의 누적 성장배율. 중간 리밸런싱 없이 합산합니다.", "Initial weight × this path’s cumulative growth, summed without rebalancing.")}</p><p>{result.modelVersion} · seed {result.seed}</p>{result.factors.map(factor => <p key={factor.key}>{factor.label}: {factor.source} · {factor.observationDate}</p>)}</details>
      {!handle.preview ? <button type="button" disabled={deleting} onClick={async () => { setDeleting(true); try { const response = await fetch("/api/simulation/path-detail", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, pathIndex }) }); if (!response.ok) throw Error("delete"); setResult(null); setError("missing"); } catch { setError("unavailable"); } finally { setDeleting(false); } }}>{t("이 실행 삭제", "Delete this execution")}</button> : null}
    </>}
  </section>;
}
