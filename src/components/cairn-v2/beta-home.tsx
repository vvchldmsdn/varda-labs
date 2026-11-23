"use client";

import { instrumentLabel } from "@/lib/instrument-display";
import { Button as CairnButton, Status as CairnStatus, ActionGroup, ActionContent } from "@/components/cairn-ui";
import { ChartNoAxesCombined } from 'lucide-react';
import { HoldingHeatmap } from './holding-heatmap';

import { HomeSimulationPending } from "./home-simulation";
import { ContributionEntry } from "./home-contribution-entry";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
const LazyHomeSimulation = dynamic(() => import("./home-simulation-lazy").then(module => module.LazyHomeSimulation), { loading: () => <HomeSimulationPending detail /> });
import { HomeCard as Card } from "./home-card";
import { cardTitles, type CardKind } from "./card-definition";
import { MetricControls, PeriodControls } from "./history-detail-controls";
import { HomeToday } from "./home-today";
import { HomeImpactControls, HomeImpactProvider } from "./home-impact";
import { HomePerformanceProvider, usePeriodPerformance } from "./home-performance";
import { readStateText } from "@/lib/cairn-v2/read-presentation";
import { displayReadMoney, type DomainRead } from "@/lib/cairn-v2/read-contract";
import { originalCurrentComposition, originalCurrentValueSummary } from "@/lib/cairn-v2/current-value-presentation";
import { useBetaView } from "./use-beta-view";
import { useHomeHistoryRead } from "./use-home-history-read";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { BetaShell } from "./beta-shell";
import { BetaDialog, type ExpansionOrigin } from "./beta-dialog";
const BetaDetail = dynamic(() => import("./beta-details").then((module) => module.BetaDetail), {
  loading: () => (
    <CairnStatus as="div" role="status" className={styles.detailLoading}>
      상세 정보를 여는 중
    </CairnStatus>
  ),
});
import { HistoryChart } from "./beta-charts";
import { HomeAllocation } from "@/components/home/home-allocation";
import { useBetaPreferences } from "./beta-provider";
import { useBetaContext } from "./use-beta-context";
import styles from "./beta.module.css";
import home from './home-layout.module.css';

import { HOME_ALLOCATION_COLORS } from "@/components/portfolio/allocation-colors";

function HistoryFooter() {
  const performance = usePeriodPerformance();
  return <div className={home.historyFooter}>{!performance && <HomeImpactControls />}<PeriodControls /></div>;
}

export function BetaHome({
  initialContext,
  read,
}: {
  initialContext: BetaContext;
  read?: DomainRead;
}) {
  const [context, setContext] = useBetaContext(initialContext);
  const { selected, setSelected, period, metric } = useBetaPreferences();
  const [expanded, setExpanded] = useState<{ kind: CardKind; origin: ExpansionOrigin } | null>(null);
  const needsFullHistory = period === "ALL" || expanded?.kind === "history" ||
    metric === "return" && !context.scope.startsWith("portfolio:");
  const history = useHomeHistoryRead(useBetaView(context, read), read, context, needsFullHistory);
  const view = history.view;
  const originalValue = view.domain?.currentValuePresentation ? originalCurrentValueSummary(view.domain.currentValuePresentation,context.currency) : null;
  const composition = view.domain?.currentValuePresentation ? originalCurrentComposition(view.domain.currentValuePresentation, context.currency) : null;
  const compositionRequested = !!view.domain?.currentValuePresentation;
  const allocationEntries = compositionRequested ? composition?.positions.flatMap((row, index) => row.displayWeightPct === null || row.displayWeightPct <= 0 ? [] : [{
    key: row.key, name: instrumentLabel(row), weightPct: row.displayWeightPct,
    color: HOME_ALLOCATION_COLORS[index % HOME_ALLOCATION_COLORS.length],
  }]) ?? [] : view.rows.map((row,index) => ({key:row.key,name:instrumentLabel(row),weightPct:row.weightPct,color:HOME_ALLOCATION_COLORS[index % HOME_ALLOCATION_COLORS.length]}));
  const displayMoney = (value: number | null, currency: BetaContext["currency"], signed = false) =>
    displayReadMoney(view, value, currency, signed);
  const unit = context.currency === "KRW" ? "원" : "USD";
  function open(kind: CardKind, trigger: HTMLElement) {
    const card = trigger.closest<HTMLElement>("[data-beta-card]") ?? trigger;
    setExpanded({ kind, origin: { rect: card.getBoundingClientRect(), trigger } });
  }
  const [contributionDirty, setContributionDirty] = useState(false);
  useEffect(() => {
    const resume = () => {
      if (location.hash === '#beta-target-drift') {
        const trigger = document.querySelector<HTMLElement>('[data-beta-card="structure"] [data-expand]');
        if (trigger) {
          // A fragment can open the dialog without a click. Give the native
          // dialog the same focus origin it would have on keyboard activation.
          trigger.focus({ preventScroll: true });
          open("drift", trigger);
        }
        return;
      }
      if (location.hash !== '#beta-contribution') return;
      const trigger = document.getElementById('beta-contribution');
      if (trigger) trigger.click();
    };
    resume(); window.addEventListener('hashchange', resume);
    return () => window.removeEventListener('hashchange', resume);
  }, []);
  const active = allocationEntries.find((r) => r.key === selected) ?? allocationEntries[0];
  const contributionTotal = view.contribution.length
    ? view.contribution.reduce((sum, r) => sum + r.amountKrw, 0)
    : null;
  const contributionReady = view.domain
    ? !contributionDirty && view.domain.planning?.contribution?.state === 'ready'
    : contributionTotal !== null;
  const formattedValue = originalValue
    ? originalValue.amount === null ? "—" : Number(originalValue.amount).toLocaleString("ko-KR", {maximumFractionDigits: context.currency === "USD" ? 2 : 0})
    : displayMoney(view.rows.length ? view.totalKrw : null, context.currency);
  const movement = view.domain?.currentHoldingMovement;
  const homeSummary = {
    count: originalValue?.coverage?.positions ?? (view.domain ? null : view.rows.length),
    balance: formattedValue === "—" ? null : `${originalValue && !originalValue.complete ? "확인 소계 " : ""}${formattedValue} ${unit}`,
    change: context.currency === "KRW" && movement?.returnPct != null && !movement.excludedCount
      ? `오늘 ${movement.returnPct > 0 ? "+" : ""}${movement.returnPct.toFixed(2)}%` : null,
  };
  return (
    <BetaShell context={context} setContext={setContext} readView={view} homeSummary={homeSummary}>
      <HomeImpactProvider read={view.domain?.heatmap} review={view.domain?.accountHistoryReview}>
      <HomePerformanceProvider view={view} context={context} read={read}>
      <div className={home.dashboard}>
        <div className={home.hero}>
          <div className={home.summary}>

          <Card onOpen={open} kind="value" controls={<span className={home.syncHint} aria-hidden>동기화 중</span>}>
            <div
              key={context.scope + context.currency}
              className={styles.mainNumber}
              data-large={
                context.fixture === "large" || (view.totalKrw !== null && view.totalKrw >= 1e11)
              }
            >
              <span>{formattedValue}</span>
              <small>{unit}</small>
            </div>
            <p className={styles.cardFootnote}>
              {originalValue ? originalValue.coverage
                ? originalValue.complete
                  ? `보유 ${originalValue.coverage.positions}건`
                  : `평가 소계 · ${originalValue.coverage.valued}/${originalValue.coverage.positions}건 · 제외 ${originalValue.coverage.excludedPositions}건`
                : originalValue.amount === null ? "평가 조회 실패 · 다시 조회해 주세요" : originalValue.asOf
                : view.domain
                ? (readStateText(view.domain.valueState, "보유 자산 없음") ??
                  (view.domain.valueState === "partial"
                    ? "전체 합계 확인 전"
                    : view.domain.valueState === "empty"
                      ? "보유 자산 없음"
                      : view.domain.refreshedAt
                        ? "조회 " +
                          new Date(new Date(view.domain.refreshedAt).getTime() + 9 * 3600000)
                            .toISOString()
                            .slice(5, 16)
                            .replace("T", " ") +
                          " KST"
                        : "확인 전"))
                : "예시 · 10.02 07:00"}
            </p>
          </Card>
          <Card onOpen={open} kind="today" expandText="기여율 상세">
            <HomeToday key={context.scope + context.currency} view={view} currency={context.currency} />
          </Card>
          </div>
          <div className={home.history}>
            <Card onOpen={open} kind="history" className={!view.history.length ? home.noHistory : undefined} controls={<MetricControls compact />}>
              <HistoryChart view={view} compact interactive currency={context.currency} />
              <HistoryFooter />
              {history.error && <CairnStatus as="div" role="status">
                <p>{history.error === 'session' ? '계좌 연결이 바뀌었어요. 화면을 새로고침해 주세요.' : '전체 이력을 불러오지 못했어요.'}</p>
                <CairnButton type="button" variant="bare" onClick={() => history.error === 'session' ? window.location.reload() : history.retry()}>{history.error === 'session' ? '새로고침' : '다시 조회'}</CairnButton>
              </CairnStatus>}
            </Card>

          </div>

        </div>
        <div className={home.lower}>
          <Card onOpen={open} kind="structure" className={!allocationEntries.length ? home.noHoldings : undefined}>
            {compositionRequested && composition && !composition.complete ? <p className={styles.cardFootnote}>확인된 소계 내 비중 · 제외 {composition.counts.excluded}건</p> : null}
            {!compositionRequested && view.domain?.excluded.length ? (
              <p className={styles.cardFootnote}>
                확인 가능한 소계 {displayMoney(view.domain.knownSubtotalKrw, context.currency)}{" "}
                {context.currency} · 제외 {view.domain.excluded.length}종목 · 소계 내 비중
              </p>
            ) : null}
            {!compositionRequested && view.domain && view.domain.nonInvestmentCount > 0 && (
              <p className={styles.cardFootnote}>
                투자자산 소계 내 비중 · 비투자자산 {view.domain.nonInvestmentCount}개 별도
              </p>
            )}
            {(compositionRequested ? !allocationEntries.length : readStateText(view.domain?.valueState, "보유 종목 없음") || !view.rows.length) ? (
              <CairnStatus as="p" className={styles.empty} role="status">
                {compositionRequested ? composition ? composition.counts.positions ? "평가할 수 있는 보유자산이 없어요. 확대하여 필요한 자료를 확인해 주세요." : "보유 자산 없음" : "현재 평가를 불러오지 못했어요. 다시 조회해 주세요." : readStateText(view.domain?.valueState, "보유 종목 없음") ?? "보유 종목 없음"}
              </CairnStatus>
            ) : (
              <div className={home.allocation}>
                <HomeAllocation
                  entries={allocationEntries}
                  selectedKey={active?.key ?? ""}
                  onSelect={setSelected}
                />
              </div>
            )}
          </Card>

          <div className={home.planning}>
            {view.domain ? (
              <ContributionEntry key={context.scope} view={view} context={context} dirty={contributionDirty} colors={HOME_ALLOCATION_COLORS}
                className={!contributionReady ? home.contributionStatus : undefined}
                onView={(trigger, amount) => {
                  if (amount !== undefined && amount !== context.cashAmountKrw) setContext({ ...context, cashAmountKrw: amount });
                  open("contribution", trigger);
                }} />
            ) : (
              <Card onOpen={open} kind="contribution" className={!contributionReady ? home.contributionStatus : undefined}>
              <div className={`${styles.contributionBody} ${!view.contribution.length ? home.noAllocation : ''}`}>
                <div>
                  <div className={styles.mainNumber}>
                    {contributionTotal === null
                      ? "—"
                      : context.currency === "KRW"
                        ? contributionTotal / 10000
                        : displayMoney(contributionTotal, context.currency)}
                    {contributionTotal !== null && (
                      <small>{context.currency === "KRW" ? "만원" : "USD"}</small>
                    )}
                  </div>
                  <p className={styles.cardFootnote}>
                    {contributionTotal === null
                      ? view.domain
                        ? "미연결 · 추가 투자 정책"
                        : "계산 대기 · 배분 근거 없음"
                      : "목표비중 기준 · 배분 예시"}
                  </p>
                </div>
                <div className={styles.allocationRows}>
                  {view.contribution.map((r, i) => (
                    <div key={r.ticker}>
                      <span>{r.ticker}</span>
                      <i>
                        <span
                          style={{
                            width: `${(r.amountKrw / 700000) * 100}%`,
                            background: view.rows.find((h) => h.key === r.ticker)?.color,
                          }}
                        />
                      </i>
                      <span>
                        {context.currency === "KRW"
                          ? `${r.amountKrw / 10000}만`
                          : displayMoney(r.amountKrw, context.currency)}
                      </span>
                      <span className={styles.visuallyHidden}>{i + 1}번째 가상 배분</span>
                    </div>
                  ))}
                </div>
              </div>
              </Card>
            )}

            {!view.domain && <CairnButton variant="bare" className={home.planLink} type="button" onClick={event => open("contribution", event.currentTarget)}>배분 보기</CairnButton>}
          </div>
        </div>
          <Card onOpen={open} kind="heatmap" className={home.heatmap}>
            <HoldingHeatmap view={view} compact maxDates={14} />
          </Card>
      </div>
      {view.rows.length > 0 && <section className={home.explore} aria-label="포트폴리오 더 살펴보기">
        <h2>내 자산, 다른 관점으로</h2>
        <ActionGroup label="포트폴리오 탐색">
          <CairnButton variant="bare" type="button" data-beta-card="simulation" onClick={event => open('simulation', event.currentTarget)}><ActionContent icon={<ChartNoAxesCombined />} title="시뮬레이션 살펴보기" description="현재 보유로 가능한 경로를 비교해요" /></CairnButton>
        </ActionGroup>
      </section>}
      {expanded && (
        <BetaDialog homeMotion
          label={expanded.kind === "structure" ? "포트 구조" : cardTitles[expanded.kind]}
          origin={expanded.origin}
          onClosed={() => {
            setExpanded(null);
            setContributionDirty(false);
          }}
        >
          {expanded.kind === "history" && history.error ? <CairnStatus as="div" role="status">
            <p>{history.error === 'session' ? '계좌 연결이 바뀌었어요. 화면을 새로고침해 주세요.' : '전체 이력을 불러오지 못했어요.'}</p>
            <CairnButton type="button" variant="secondary" onClick={() => history.error === 'session' ? window.location.reload() : history.retry()}>{history.error === 'session' ? '새로고침' : '다시 조회'}</CairnButton>
          </CairnStatus> : null}
          {expanded.kind === "simulation" && view.domain ? (
            view.domain.state === "loading" ? (
              <HomeSimulationPending detail />
            ) : read?.displayBinding ? (
              <LazyHomeSimulation
                context={context}
                binding={read.displayBinding}
                receipt={read.readReceipt}
                epoch={read.readEpoch}
              />
            ) : <CairnStatus as="p" role="status">계좌 연결을 확인한 뒤 다시 열어 주세요.</CairnStatus>
          ) : (
            <BetaDetail
              onTargetDrift={() =>
                setExpanded((current) => (current ? { ...current, kind: "drift" } : null))
              }
              kind={expanded.kind}
              view={view}
              context={context}
              historyRead={read}
              onAllHistoryAccounts={() => setContext({ ...context, scope: "all" })}
              onContributionEdit={setContributionDirty}
              onContributionCalculate={(amount, keys) =>
                setContext({
                  ...context,
                  cashAmountKrw: amount,
                  excludeSell: keys?.length ? keys : undefined,
                })
              }
            />
          )}
        </BetaDialog>
      )}
      </HomePerformanceProvider>
      </HomeImpactProvider>
    </BetaShell>
  );
}
