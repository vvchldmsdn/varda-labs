"use client";
import { useState, type ReactNode } from "react";
import { PortfolioAllocationRing } from "@/components/portfolio/portfolio-allocation-ring";
import { analyzeQuickPortfolio, type QuickInput } from "@/lib/quick-portfolio";
import styles from "./quick-portfolio.module.css";
export function QuickResults({ input, action, compact = false }: { input: QuickInput; action?: ReactNode; compact?: boolean }) {
  const result = analyzeQuickPortfolio(input);
  const [selected, setSelected] = useState("0");
  const row = result.rows.find(item => item.key === selected) ?? result.rows[0];
  return <section className={`${styles.results} ${compact ? styles.compactResult : ""}`} aria-label="내 입력 자산 분석">
    <p className={styles.eyebrow}>내가 입력한 범위의 분석</p><h2>{result.total.toLocaleString("ko-KR")}원, 이렇게 나뉘어 있어요.</h2>
    <p>가장 큰 자산은 <strong>{result.largest.name} · {result.largest.weightPct.toFixed(1)}%</strong>입니다.</p>
    {action ? <div className={styles.actions}>{action}</div> : null}
    <div className={styles.chart}><PortfolioAllocationRing entries={result.rows} selectedKey={row.key} onSelect={setSelected} compositionOnly />
      <div className={styles.assetList}>{result.rows.map(item => <button type="button" aria-pressed={row.key === item.key} key={item.key} onClick={() => setSelected(item.key)}><span>{item.name}</span><strong>{item.weightPct.toFixed(1)}%</strong></button>)}<p>{row.name} · {row.value.toLocaleString("ko-KR")}원</p></div>
    </div>
    {compact ? <details className={styles.method}><summary>자산 종류 · 거래통화</summary><div className={styles.breakdowns}><section><h3>자산 종류</h3>{result.assetClasses.map(item => <p key={item.name}><span>{item.name}</span><strong>{item.weightPct.toFixed(1)}%</strong></p>)}</section><section><h3>거래통화 기준</h3>{result.currencies.map(item => <p key={item.name}><span>{item.name}</span><strong>{item.weightPct.toFixed(1)}%</strong></p>)}</section></div></details> : <div className={styles.breakdowns}><section><h3>자산 종류</h3>{result.assetClasses.map(item => <p key={item.name}><span>{item.name}</span><strong>{item.weightPct.toFixed(1)}%</strong></p>)}</section><section><h3>거래통화 기준</h3>{result.currencies.map(item => <p key={item.name}><span>{item.name}</span><strong>{item.weightPct.toFixed(1)}%</strong></p>)}</section></div>}
    <details className={styles.method}><summary>어디까지 알 수 있나요?</summary><p>비중은 입력한 자산 금액 ÷ 입력 금액 합계입니다. 선택한 종목만 자산 종류와 거래통화를 분류하며, 직접 쓴 이름은 미확인으로 남깁니다.</p><p>거래통화는 실제 환율 노출과 다릅니다. ETF 내부 구성·환헤지·변동 기여도·위험도·미래 수익률은 금액만으로 계산하지 않습니다. 전체 재산이 아닌 입력한 범위의 현재 구성입니다.</p></details>
  </section>;
}
