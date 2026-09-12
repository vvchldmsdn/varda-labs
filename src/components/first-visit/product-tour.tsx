"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicProductDemo } from "@/lib/public-product-demo";
import styles from "./product-tour.module.css";

const Charts = dynamic(() => import("./product-demo-charts"), { loading: () => <p role="status">차트를 준비하고 있어요…</p>, ssr: false });
export function ProductTour({ standalone = false }: { standalone?: boolean }) {
  const [view, setView] = useState<"lab" | "simulation">("lab");
  const [horizon, setHorizon] = useState<63 | 126>(63);
  const [loaded, setLoaded] = useState<{ key: string; data: PublicProductDemo } | null>(null);
  const [failed, setFailed] = useState("");
  const [retry, setRetry] = useState(0);
  const key = `${view}:${horizon}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/public-demo?view=${view}&horizon=${horizon}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<PublicProductDemo>; })
      .then(data => { if (!controller.signal.aborted) setLoaded({ key, data }); })
      .catch(() => { if (!controller.signal.aborted) setFailed(key); });
    return () => controller.abort();
  }, [view, horizon, key]);
  return <section id="product-tour" className={styles.tour} aria-label="Varda 기능 체험">
    <p className={styles.eyebrow}>계획을 세운 다음에는</p>
    <h2>내 자산을 보는<br/>새로운 관점.</h2>
    <p className={styles.intro}>다른 선택과 비교하고, 가능한 미래를 탐색해보세요.</p>
    <div className={styles.tabs} role="group" aria-label="체험할 기능">
      <button type="button" aria-pressed={view === "lab"} onClick={() => setView("lab")}>투자 랩</button>
      <button type="button" aria-pressed={view === "simulation"} onClick={() => setView("simulation")}>시뮬레이션</button>
    </div>
    <div className={styles.description}><h3>{view === "lab" ? "다르게 투자했다면, 어땠을까?" : "미래는 하나의 선이 아니니까."}</h3><p>{view === "lab" ? "전략을 바꾸고 날짜를 짚어 차이를 살펴보세요." : "1,000개 예시 경로를 살펴보며 변동의 폭을 느껴보세요."}</p></div>
    <p className={styles.sampleLabel}>가상 자산·가상 시세의 예시 · 내 계산 결과가 아닙니다</p>
    {view === "simulation" ? <label className={styles.scenario}>계산 기간<select value={horizon} onChange={event => setHorizon(Number(event.target.value) as 63 | 126)}><option value={63}>63 거래 단계</option><option value={126}>126 거래 단계</option></select></label> : null}
    <div className={styles.viewport} aria-busy={loaded?.key !== key && failed !== key}>
      {loaded?.key === key ? <Charts key={key} data={loaded.data} /> : failed === key ? <div role="alert"><p>예시를 불러오지 못했어요. 계산한 계획에는 영향이 없습니다.</p><button type="button" onClick={() => setRetry(value => value + 1)}>체험 다시 불러오기</button></div> : <div className={styles.loading} role="status">{view === "lab" ? "비교 화면을 준비하고 있어요…" : "예시 경로를 계산하고 있어요…"}<div aria-hidden="true"/></div>}
    </div>
    <p className={styles.next}>보유종목 등록과 데이터 준비 후, 같은 화면에서 내 자산을 살펴볼 수 있어요.</p>
    {standalone ? <Link className={styles.returnLink} href="/plans">내 계산 결과·저장으로 돌아가기 →</Link> : <Link className={styles.returnLink} href="/explore">넓은 화면으로 체험하기 ↗</Link>}
  </section>;
}
