"use client";
import {Status} from "@/components/cairn-ui";

import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { originalHref } from "@/lib/cairn-v2/navigation";
import type { OwnerSimulationModel, SimulationRead } from "@/lib/cairn-v2/simulation-contract";
import { SimulationFanExplorer } from "./reused/simulation-fan-explorer";
import { resolveSimulationFanPathSource, simulationFanPathCount } from "./reused/simulation-presentation";
import { StatusPill } from "./ui/atoms";
import { DetailHeader, Metric, MetricGroup, SectionHeading } from "./ui/molecules";
import { formatNumber, formatPercent } from "./ui/format";
import styles from "./simulation-result.module.css";

export function ownerResearchChart(model: OwnerSimulationModel, identity: string) {
  const execution = model.execution;
  if (!execution.assumptions) return null;
  return {
    id: identity, name: "현재 보유", assumptions: execution.assumptions,
    bands: execution.bands, samplePaths: execution.samplePaths, displayPaths: execution.displayPaths,
  };
}

/** One result composition for the home dialog and the dedicated research page. */
export default function SimulationResultDetail({ read, context, heading = true }: {
  read: SimulationRead; context: BetaContext; heading?: boolean;
}) {
  const model = read.model;
  if (!model || model.execution.status !== "ready" || !read.resultIdentity) return null;
  const execution = model.execution;
  const chart = ownerResearchChart(model, read.resultIdentity);
  if (!chart || !execution.terminal) return null;
  const terminal = execution.terminal;
  const source = resolveSimulationFanPathSource(chart);
  const pathCount = simulationFanPathCount(source);
  const coverage = Math.max(0, Math.min(100, execution.coverage.modeledCurrentValuePct));
  const scopeLabel = read.scopes.find(scope => scope.key === context.scope)?.label ?? "현재 선택 범위";
  const historicalLink = originalHref("/simulation", {
    ...context, currency: "KRW",
    ...(execution.source?.lastServiceDate ? { end: execution.source.lastServiceDate } : {}),
    horizon: String(chart.assumptions.horizon),
  }) + "&model=bootstrap";

  return <section className={styles.result} aria-label="현재 보유 연구 상세"
    data-home-simulation-state={read.state} data-result-identity={read.resultIdentity}>
    {heading && <DetailHeader title="시뮬레이션" description={scopeLabel + " · KRW"} />}

    {model.priceFrontier&&<Status role="note" className={styles.priceEvidence} data-price-frontier={model.priceFrontier.status}>
      <p><strong>{execution.endSelection.source==='latest_common_stored'?'최신 확인 종가':'사용한 확인 종가'}</strong><span>{model.priceFrontier.usTradeDate&&'미국 거래일 '+model.priceFrontier.usTradeDate+' · '}관측 기준 {model.priceFrontier.serviceDate}</span></p>
      {model.priceFrontier.status==='provider_pending'&&model.priceFrontier.pendingUsTradeDate&&<details><summary>최근 종가 갱신 안내</summary><p>{model.priceFrontier.pendingUsTradeDate} 미국 일봉은 공급자에서 갱신 중이어서 제외했습니다. 확정된 종가가 수집되면 최신 기준에 반영합니다.</p></details>}
    </Status>}
    <div className={styles.context}>
      <StatusPill>과거 수익률 재표본</StatusPill>
      <span>{chart.assumptions.horizon}개 관측 단계</span>
      <span>{formatNumber(pathCount, { maximumFractionDigits: 0 })}개 경로 {source.kind === "all" ? "전체 표시" : "표본 표시"}</span>
      <span>관측 기준 {execution.source?.lastServiceDate}</span>
      <span>미래 예측 아님</span>
    </div>

    <section className={styles.chartSection} aria-label="전체 계산 경로">
      <SimulationFanExplorer key={read.resultIdentity} execution={chart} large initialMode="paths" />
    </section>

    <MetricGroup className={styles.metrics}>
      <Metric label="종료 수익률 중앙값" value={formatPercent(terminal.p50ReturnPct, 2, true)}
        tone={terminal.p50ReturnPct < 0 ? "negative" : "positive"} note="전체 계산 경로의 중간 결과" />
      <Metric label="손실로 끝난 경로" value={formatPercent(terminal.lossProbabilityPct, 1)}
        note="시작값보다 낮게 끝난 비율" />
      <Metric label="최대 낙폭 중앙값 · P50" value={formatPercent(terminal.maxDrawdownP50Pct, 1)}
        note={`P90 ${formatPercent(terminal.maxDrawdownP90Pct, 1)} · 약 10% 경로는 이보다 더 하락`} />
    </MetricGroup>

    <section className={styles.coverage} aria-label="연구에 포함된 보유 범위">
      <div>
        <SectionHeading title="어디까지 포함했나요?"
          actions={<StatusPill>{execution.coverage.modeledInstrumentCount}/{execution.coverage.candidateInstrumentCount}종목</StatusPill>} />
        <div className={styles.coverageBar} role="img" aria-label={"후보 평가액의 " + formatPercent(coverage, 1) + " 포함"}>
          <span style={{ width: coverage + "%" }} />
        </div>
        <p className={styles.coverageCaption}><strong>{formatPercent(coverage, 1)} 포함</strong><span>{formatPercent(100 - coverage, 1)} 제외</span></p>
      </div>
      <p className={styles.coverageCopy}>{read.state === "partial"
        ? "시세 이력이 충분한 종목만 포함했습니다. 포함 종목의 비중을 100%로 환산한 결과이며, 전체 계좌의 결과와 다릅니다."
        : "현재 연구 대상의 보유 비중을 사용했습니다. 이후 매매나 추가 투입은 가정하지 않습니다."}</p>
    </section>

    <details className={styles.disclosure}>
      <summary>포함 종목과 제외 사유<span aria-hidden="true">＋</span></summary>
      <div className={styles.tableScroll} role="region" aria-label="시뮬레이션 포함 종목" tabIndex={0}>
        <table>
          <caption>현재 후보 비중과 계산에 사용한 비중</caption>
          <thead><tr><th>종목</th><th>현재 비중</th><th>계산 비중</th><th>포함 상태</th></tr></thead>
          <tbody>{model.candidate.instruments.map(instrument => {
            const weight = execution.executionWeights.find(row => row.instrumentKey === instrument.instrumentKey);
            const included = weight != null && weight.weightBps > 0;
            return <tr key={instrument.instrumentKey}>
              <th scope="row">{instrument.name}<small>{instrument.ticker} · {instrument.accounts.join(" / ")}</small></th>
              <td>{formatPercent(instrument.weightBps == null ? null : instrument.weightBps / 100)}</td>
              <td>{formatPercent(weight == null ? null : weight.weightBps / 100)}</td>
              <td><StatusPill tone={included ? "neutral" : "muted"}>{included ? "포함" : "제외"}</StatusPill>
                {!included && <small>{instrument.classification === "physical_commodity_position" ? "연속 가격 이력 부족" : "가격·환율 또는 포함 근거 부족"}</small>}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {model.candidate.summary.fountExcludedHoldingCount > 0 && <p>FOUNT 보유 {model.candidate.summary.fountExcludedHoldingCount}개는 연구 정책상 제외했습니다.</p>}
    </details>

    <details className={styles.disclosure}>
      <summary>계산 방식과 결과 읽는 법<span aria-hidden="true">＋</span></summary>
      <dl className={styles.methodGrid}>
        <div><dt>사용한 관측</dt><dd>{execution.source?.firstServiceDate} — {execution.source?.lastServiceDate}</dd><dd>{execution.source?.returnStepCount}개 수익률 관측 · 날짜별 저장 환율</dd></div>
        <div><dt>경로 계산</dt><dd>과거 수익률을 평균 {chart.assumptions.expectedBlockLength}단계 블록으로 재표본 추출</dd><dd>초기 비중 유지 · 중간 리밸런싱 없음</dd></div>
        <div><dt>분포 읽기</dt><dd>P50은 시점별 중앙값이며 특정 경로 하나가 아닙니다. P10–P90는 모형 안의 80% 구간입니다.</dd></div>
        <div><dt>계산 범위</dt><dd>{model.candidate.historicalPriceBasis === 'provider_adjusted_close' ? 'KRW 기준 제공사 조정 종가와 날짜별 환율을 사용합니다. 배당 재투자 총수익, 비용·세금은 보장하지 않습니다.' : 'KRW 기준 원가격 수익률입니다. 배당·분할 조정 총수익, 비용·세금은 반영하지 않았습니다.'}</dd></div>
      </dl>
      <p>기존 화면의 ‘경제지표 경로’는 별도 모형입니다. 여기서는 ‘과거 수익률 경로’를 사용하며, 모형과 관측 조건을 같게 놓고 비교해야 합니다.</p>
      <a className={styles.textLink} href={historicalLink}>기존 화면에서 과거 수익률 모형 열기 ↗</a>
    </details>
    {context.currency === "USD" && <p className={styles.currencyNote}>이 연구의 분석 통화는 KRW입니다. 화면의 USD 선택으로 결과를 재환산하지 않습니다.</p>}
  </section>;
}
