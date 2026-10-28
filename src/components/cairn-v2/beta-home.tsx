"use client";
import { Button as CairnButton, Status as CairnStatus } from "@/components/cairn-ui";

import { HoldingHeatmap } from "./holding-heatmap";
import { HomeSimulation, HomeSimulationPending } from "./home-simulation";
import homeSimulationStyles from "./home-simulation.module.css";
import type { SimulationRead } from "@/lib/cairn-v2/simulation-contract";
import heatmapStyles from "./holding-heatmap.module.css";
import { ContributionHome } from "./home-contribution";
import { TargetDriftHome } from "./target-drift-home";
import { useState } from "react";
import dynamic from "next/dynamic";
import { HomeCard as Card } from "./home-card";
import { cardTitles, type CardKind } from "./card-definition";
import { MetricControls } from "./history-detail-controls";
import { heatmapDates } from "@/lib/cairn-v2/fixtures";
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
import { HistoryChart, ScenarioChart } from "./beta-charts";
import { PortfolioAllocationRing } from "./portfolio-allocation-ring";
import { useBetaPreferences } from "./beta-provider";
import { useBetaContext } from "./use-beta-context";
import styles from "./beta.module.css";

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
  const [heatmapSelection, setHeatmapSelection] = useState<string | null>(null);
  const unit = context.currency === "KRW" ? "원" : "USD";
  function open(kind: CardKind, trigger: HTMLElement) {
    const card = trigger.closest<HTMLElement>("[data-beta-card]")!;
    setExpanded({ kind, origin: { rect: card.getBoundingClientRect(), trigger } });
  }
  const [contributionDirty, setContributionDirty] = useState(false);
  const active = view.rows.find((r) => r.key === selected) ?? view.rows[0];
  const contributionTotal = view.contribution.length
    ? view.contribution.reduce((sum, r) => sum + r.amountKrw, 0)
    : null;
  return (
    <BetaShell context={context} setContext={setContext} readView={view}>
      <div className={styles.dashboard}>
        <div className={`${styles.leftGrid} ${view.domain ? heatmapStyles.compactGrid : ""}`}>
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
          <div className={styles.historyArea}>
            <Card onOpen={open} kind="history" controls={<MetricControls compact />}>
              <HistoryChart view={view} compact />
            </Card>
            <TargetDriftHome view={view} onOpen={(trigger) => open("drift", trigger)} />
          </div>
          <Card
            onOpen={open}
            kind="heatmap"
            minimal={!!view.domain}
            className={view.domain ? heatmapStyles.compactCard : undefined}
          >
            {view.domain ? (
              <HoldingHeatmap view={view} compact />
            ) : (
              <div className={styles.heatmapViewport}>
                <div className={styles.heatmapMatrix}>
                  <div />
                  {heatmapDates.map((date) => (
                    <span className={styles.heatmapDate} key={date}>
                      {date}
                    </span>
                  ))}
                  {view.rows.map((r) => (
                    <div key={r.key} className={styles.heatmapRow}>
                      <span className={styles.ticker}>{r.key}</span>
                      {r.heatmap.map((value, index) => (
                        <CairnButton variant="bare"
                          type="button"
                          key={index}
                          title={`${r.name} · ${heatmapDates[index]} · ${value === null ? "데이터 없음" : `${value}%`}`}
                          aria-label={`${r.key} ${heatmapDates[index]} ${value === null ? "데이터 없음" : `${value}%`}`}
                          aria-pressed={heatmapSelection === `${r.key}-${index}`}
                          onClick={() => setHeatmapSelection(`${r.key}-${index}`)}
                          style={{
                            background:
                              value === null
                                ? "#eeeee9"
                                : value >= 0
                                  ? `rgba(198,70,35,${Math.min(0.7, 0.12 + value * 0.3)})`
                                  : `rgba(70,114,169,${Math.min(0.7, 0.12 + Math.abs(value) * 0.3)})`,
                          }}
                        >
                          {value === null ? "—" : ""}
                        </CairnButton>
                      ))}
                    </div>
                  ))}
                </div>
                {!view.rows.length && <p className={styles.empty}>표시할 보유 종목이 없습니다.</p>}
              </div>
            )}
            <span className={styles.visuallyHidden} aria-live="polite">
              {heatmapSelection ? `선택한 셀 ${heatmapSelection}` : ""}
            </span>
          </Card>
        </div>
        <div className={`${styles.rightGrid} ${view.domain ? homeSimulationStyles.grid : ""}`}>
          <Card onOpen={open} kind="structure">
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
            {readStateText(view.domain?.valueState, "보유 종목 없음") ? (
              <CairnStatus as="p" className={styles.empty} role="status">
                {readStateText(view.domain?.valueState, "보유 종목 없음")}
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
          <Card onOpen={open} kind="contribution">
            {view.domain ? (
              <ContributionHome view={view} dirty={contributionDirty} />
            ) : (
              <div className={styles.contributionBody}>
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
          </Card>
          <Card
            onOpen={open}
            kind="simulation"
            className={view.domain ? homeSimulationStyles.card : undefined}
          >
            {view.domain ? (
              view.domain.state === "loading" ? (
                <HomeSimulationPending />
              ) : (
                <HomeSimulation
                  promise={
                    ["ready", "partial", "empty"].includes(view.domain.state)
                      ? simulationPromise
                      : undefined
                  }
                  context={context}
                />
              )
            ) : (
              <>
                <div className={styles.scenarioCaption}>
                  <span>과거 경로 기반 · 6개월</span>
                  <span>
                    {view.rows.length
                      ? `가상 중간값 +${view.scenario.at(-1)!.middle.toFixed(1)}%`
                      : "예시 없음"}
                  </span>
                </div>
                <ScenarioChart view={view} />
              </>
            )}
          </Card>
        </div>
      </div>
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
