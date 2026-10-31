"use client";
import { Button as CairnButton, Status as CairnStatus, ActionGroup, ActionContent } from "@/components/cairn-ui";
import { Grid2X2, ChartNoAxesCombined, ArrowRight } from 'lucide-react';

import { HomeSimulation, HomeSimulationPending } from "./home-simulation";
import type { SimulationRead } from "@/lib/cairn-v2/simulation-contract";
import { ContributionHome } from "./home-contribution";
import { TargetDriftHome } from "./target-drift-home";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { HomeCard as Card } from "./home-card";
import { cardTitles, type CardKind } from "./card-definition";
import { MetricControls } from "./history-detail-controls";
import { HomeToday } from "./home-today";
import { readStateText } from "@/lib/cairn-v2/read-presentation";
import { displayReadMoney, type DomainRead } from "@/lib/cairn-v2/read-contract";
import { useBetaView } from "./use-beta-view";
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
import { PortfolioAllocationRing } from "./portfolio-allocation-ring";
import { useBetaPreferences } from "./beta-provider";
import { useBetaContext } from "./use-beta-context";
import styles from "./beta.module.css";
import home from './home-layout.module.css';

export function BetaHome({
  initialContext,
  read,
  simulationPromise,
}: {
  initialContext: BetaContext;
  read?: DomainRead;
  simulationPromise?: Promise<SimulationRead>;
}) {
  const [context, setContext] = useBetaContext(initialContext);
  const view = useBetaView(context, read);
  const displayMoney = (value: number | null, currency: BetaContext["currency"], signed = false) =>
    displayReadMoney(view, value, currency, signed);
  const { selected, setSelected } = useBetaPreferences();
  const [expanded, setExpanded] = useState<{ kind: CardKind; origin: ExpansionOrigin } | null>(
    null,
  );
  const unit = context.currency === "KRW" ? "원" : "USD";
  function open(kind: CardKind, trigger: HTMLElement) {
    const card = trigger.closest<HTMLElement>("[data-beta-card]")!;
    setExpanded({ kind, origin: { rect: card.getBoundingClientRect(), trigger } });
  }
  const [contributionDirty, setContributionDirty] = useState(false);
  useEffect(() => {
    const resume = () => {
      if (location.hash !== '#beta-contribution') return;
      const trigger = document.getElementById('beta-contribution');
      if (trigger) trigger.click();
    };
    resume(); window.addEventListener('hashchange', resume);
    return () => window.removeEventListener('hashchange', resume);
  }, []);
  const active = view.rows.find((r) => r.key === selected) ?? view.rows[0];
  const contributionTotal = view.contribution.length
    ? view.contribution.reduce((sum, r) => sum + r.amountKrw, 0)
    : null;
  const contributionNeedsReview = !view.rows.length ||
    view.domain?.planning?.contribution?.state === 'blocked' ||
    view.domain?.planning?.contribution?.state === 'unavailable';
  return (
    <BetaShell context={context} setContext={setContext} readView={view}>
      <div className={home.dashboard}>

          <Card onOpen={open} kind="value">
            <div
              className={styles.mainNumber}
              data-large={
                context.fixture === "large" || (view.totalKrw !== null && view.totalKrw >= 1e11)
              }
            >
              <span>{displayMoney(view.rows.length ? view.totalKrw : null, context.currency)}</span>
              <small>{unit}</small>
            </div>
            <p className={styles.cardFootnote}>
              {view.domain
                ? (readStateText(view.domain.valueState, "보유 자산 없음") ??
                  (view.domain.valueState === "partial"
                    ? "전체 합계 확인 전"
                    : view.domain.valueState === "empty"
                      ? "보유 자산 없음"
                      : view.domain.refreshedAt
                        ? "투자자산 · 갱신 " +
                          new Date(new Date(view.domain.refreshedAt).getTime() + 9 * 3600000)
                            .toISOString()
                            .slice(5, 16)
                            .replace("T", " ") +
                          " KST"
                        : "확인 전"))
                : "10.02 07:00 기준"}
            </p>
          </Card>
          <Card onOpen={open} kind="today">
            <HomeToday view={view} currency={context.currency} />
          </Card>
          <Card onOpen={open} kind="contribution">
            {view.domain ? (
              <ContributionHome view={view} dirty={contributionDirty} />
            ) : (
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
            )}
            <CairnButton className={home.calculate} variant="primary" type="button" onClick={event => open('contribution', event.currentTarget)}>{contributionNeedsReview ? '계산 준비 확인하기' : '추가 투자 계산하기'} <ArrowRight size={18} aria-hidden="true" /></CairnButton>
          </Card>
          <div className={home.history}>
            <Card onOpen={open} kind="history" className={!view.history.length ? home.noHistory : undefined} controls={<MetricControls compact />}>
              <HistoryChart view={view} compact />
            </Card>
            <TargetDriftHome view={view} onOpen={(trigger) => open("drift", trigger)} />
          </div>

          <Card onOpen={open} kind="structure" className={!view.rows.length ? home.noHoldings : undefined}>
            {view.domain?.excluded.length ? (
              <p className={styles.cardFootnote}>
                확인 가능한 소계 {displayMoney(view.domain.knownSubtotalKrw, context.currency)}{" "}
                {context.currency} · 제외 {view.domain.excluded.length}종목 · 소계 내 비중
              </p>
            ) : null}
            {view.domain && view.domain.nonInvestmentCount > 0 && (
              <p className={styles.cardFootnote}>
                투자자산 소계 내 비중 · 비투자자산 {view.domain.nonInvestmentCount}개 별도
              </p>
            )}
            {readStateText(view.domain?.valueState, "보유 종목 없음") || !view.rows.length ? (
              <CairnStatus as="p" className={styles.empty} role="status">
                {readStateText(view.domain?.valueState, "보유 종목 없음") ?? "보유 종목 없음"}
              </CairnStatus>
            ) : (
              <div className={styles.homeRing}>
                <PortfolioAllocationRing
                  compositionOnly={!!view.domain}
                  entries={view.rows.map((r) => ({
                    key: r.key,
                    name: r.ticker ?? r.name,
                    weightPct: r.weightPct,
                    color: r.color,
                  }))}
                  selectedKey={active?.key ?? ""}
                  onSelect={setSelected}
                />
              </div>
            )}
          </Card>

      </div>
      {view.rows.length > 0 && <section className={home.explore} aria-label="포트폴리오 더 살펴보기">
        <h2>내 자산, 다른 관점으로</h2>
        <ActionGroup label="포트폴리오 탐색">
          <CairnButton variant="bare" type="button" data-beta-card="heatmap" onClick={event => open('heatmap', event.currentTarget)}><ActionContent icon={<Grid2X2 />} title="종목별 흐름 보기" description="어떤 종목이 함께 움직였을까요?" /></CairnButton>
          <CairnButton variant="bare" type="button" data-beta-card="simulation" onClick={event => open('simulation', event.currentTarget)}><ActionContent icon={<ChartNoAxesCombined />} title="시뮬레이션 살펴보기" description="현재 보유로 가능한 경로를 비교해요" /></CairnButton>
        </ActionGroup>
      </section>}
      {expanded && (
        <BetaDialog
          label={expanded.kind === "structure" ? "포트 구조" : cardTitles[expanded.kind]}
          origin={expanded.origin}
          onClosed={() => {
            setExpanded(null);
            setContributionDirty(false);
          }}
        >
          {expanded.kind === "simulation" && view.domain ? (
            view.domain.state === "loading" ? (
              <HomeSimulationPending detail />
            ) : (
              <HomeSimulation
                promise={
                  ["ready", "partial", "empty"].includes(view.domain.state)
                    ? simulationPromise
                    : undefined
                }
                context={context}
                detail
              />
            )
          ) : (
            <BetaDetail
              onTargetDrift={() =>
                setExpanded((current) => (current ? { ...current, kind: "drift" } : null))
              }
              kind={expanded.kind}
              view={view}
              context={context}
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
    </BetaShell>
  );
}
