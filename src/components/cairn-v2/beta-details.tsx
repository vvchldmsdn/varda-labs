"use client";

import { instrumentLabel } from "@/lib/instrument-display";
import Link from "next/link";
import { ActionGroup, ActionContent } from "@/components/cairn-ui";
import { Target } from "lucide-react";
import { layoutPortfolioTreemap } from "@/lib/portfolio-structure-treemap";
import structureLayout from "./structure-detail.module.css";
import { HoldingHeatmap } from "./holding-heatmap";
import { useLayoutEffect, useRef } from "react";
import { ContributionDetail, TargetDetail, driftNumber, targetMessage } from "./planning-details";
import { ReadSummary } from "./read-summary";
import { readStateText } from "@/lib/cairn-v2/read-presentation";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import { fixtureNotice, type FixtureView } from "@/lib/cairn-v2/fixtures";
import { betaReadHref, betaHref, originalHref, type BetaContext } from "@/lib/cairn-v2/navigation";
import { useBetaPreferences, useBetaReadFreshness } from "./beta-provider";
import { HistoryDetail } from "./history-detail";
export { MetricControls } from "./history-detail-controls";
import { DetailHeader } from "./ui/molecules";
import { cardTitles, cardOriginals, type CardKind } from "./card-definition";
export { cardTitles, cardOriginals, type CardKind } from "./card-definition";
import { PortfolioAllocationRing } from "./portfolio-allocation-ring";
import styles from "./beta.module.css";
import { CairnSelect } from "./reused/cairn-select";
import evidence from "./reused/holding-evidence.module.css";
import { dataIssueLabel } from "@/lib/data-issue-presentation";
import { originalCurrentComposition } from "@/lib/cairn-v2/current-value-presentation";
import { compositionPriceTime } from "@/lib/current-investment-composition";

function StructureDetail({
  view,
  context,
  workspace,
  onTargetDrift,
}: {
  view: FixtureView;
  context: BetaContext;
  workspace: boolean;
  onTargetDrift?: () => void;
}) {
  const freshness = useBetaReadFreshness();
  const displayMoney = (n: number | null, c: BetaContext["currency"], signed = false) =>
    displayReadMoney(view, n, c, signed);
  const { selected, setSelected, structureView, setStructureView } = useBetaPreferences();
  const currentRead = view.domain?.currentValuePresentation;
  const composition = currentRead ? originalCurrentComposition(currentRead, context.currency) : null;
  const compositionRequested = !!currentRead;
  const formatAmount = (amount: number | string | null) => compositionRequested
    ? amount === null ? "—" : Number(amount).toLocaleString("ko-KR", {maximumFractionDigits:context.currency === "USD" ? 2 : 0})
    : displayMoney(amount === null ? null : Number(amount), context.currency);
  const rows = compositionRequested ? composition?.positions.flatMap((row, index) => row.value === null || row.displayWeightPct === null ? [] : [{
    ...row, amount: row.value, weightPct: row.displayWeightPct, targetPct: null,
    color: workspace ? ["#f29579","#b0bcaa","#d9bd97","#78929e","#a499aa"][index % 5] : ["#ef5a32", "#343932", "#cca17b", "#8c9f89", "#697f8c"][index % 5],
  }]) ?? [] : view.rows.map(row => ({...row,amount:row.valueKrw,manuallyEntered:false}));
  const excluded = compositionRequested ? composition?.positions.filter(row=>row.value === null) ?? [] : view.domain?.excluded ?? [];
  const amount = compositionRequested ? composition?.amount ?? null : view.rows.length ? view.totalKrw : null;
  const stateText = compositionRequested ? !composition ? "현재 평가를 불러오지 못했어요. 다시 조회해 주세요." : !composition.counts.positions ? "보유 자산 없음" : null
    : readStateText(view.domain?.valueState, "보유 종목 없음");
  if (stateText)
    return (
      <p className={styles.empty} role="status">
        {stateText}
      </p>
    );
  const active = rows.find((r) => r.key === selected) ?? rows[0];
  const activeEvidence = composition?.positions.find(row=>row.key===active?.key);
  const activePriceTime = activeEvidence ? compositionPriceTime(activeEvidence) : {label:"가격 관측",value:active?.priceAsOf};
  const mapRows = new Map(rows.map(row => [row.key, row]));
  const mapRects = structureView === "map"
    ? layoutPortfolioTreemap(rows.map(row => ({ key: row.key, value: row.weightPct })), 100, 100)
    : [];
  const target =
    (!compositionRequested || currentRead?.kind === "legacy" && composition?.complete) && view.domain?.planning?.targets.state === "ready"
      ? view.domain.planning.targets.rows.find((row) => row.key === active?.key)
      : null;
  return (
    <>
      <div className={styles.structureHeading}>
        <h3>자산 배분</h3>
        <div className={styles.textTabs} role="group" aria-label="포트 구조 보기">
          <button
            type="button"
            aria-pressed={structureView === "ring"}
            onClick={() => setStructureView("ring")}
          >
            원형
          </button>
          <button
            type="button"
            aria-pressed={structureView === "map"}
            onClick={() => setStructureView("map")}
          >
            비중 지도
          </button>
        </div>
      </div>
      {view.domain && (excluded.length > 0 || composition && !composition.complete) && (
        <p className={styles.muted}>
          확인 가능한 소계 {formatAmount(compositionRequested ? amount : view.domain.knownSubtotalKrw)}{" "}
          {context.currency} · 소계 내 비중 · 제외 {excluded.length}건
        </p>
      )}
      {!!excluded.length && <details className={structureLayout.exclusions}><summary>제외된 보유 {excluded.length}건 확인</summary>{excluded.map((r, i) => (
        <p key={i} className={styles.muted}>
          제외: {instrumentLabel(r)}{r.currency ? ` · ${r.currency}` : ""} · {dataIssueLabel(r.reason ?? "valuation_incomplete")}
        </p>
      ))}</details>}
      <div className={`${structureLayout.layout} ${workspace ? structureLayout.workspace : ""}`}>
        <aside className={structureLayout.summary}>
          <p className={styles.muted}>
            {excluded.length || composition && !composition.complete
              ? "확인 가능한 소계"
              : view.domain
                ? "전체 투자자산 평가액"
                : "전체 자산 평가액"}
          </p>
          <p className={structureLayout.total}>
            {formatAmount(amount)}{" "}
            {context.currency === "KRW" ? "원" : "USD"}
          </p>
          <p className={styles.muted}>보유 건수</p>
          <p>{composition?.counts.positions ?? view.rows.length}건{composition && composition.counts.unidentifiedPositions === 0 ? ` · ${composition.counts.instruments}종목` : ""}</p>
          <p className={styles.muted}>목표비중</p>
          <p>{view.domain ? view.domain.planning?.targets.state === "ready" ? "설정됨" : targetMessage(view) : view.rows.length ? "가상 설정됨" : "없음"}</p>
        </aside>
        <div className={structureLayout.visual}>
          {structureView === "ring" ? (
            <PortfolioAllocationRing
              showHint={!workspace}
              compositionOnly={!!view.domain}
              entries={rows.map((r) => ({
                key: r.key,
                name: instrumentLabel(r),
                weightPct: r.weightPct,
                color: r.color,
              }))}
              selectedKey={active?.key ?? ""}
              onSelect={setSelected}
            />
          ) : (
            <div
              className={structureLayout.map}
              role="group"
              aria-label="비중 지도 · 면적이 비중에 비례"
            >
              {mapRects.map(rect => {
                const r = mapRows.get(rect.key)!;
                return (
                <button
                  key={r.key}
                  style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%`, background: `color-mix(in srgb, ${r.color} 18%, var(--cairn-ui-paper))` }}
                  type="button"
                  aria-label={`${instrumentLabel(r)} ${r.weightPct.toFixed(2)}%`}
                  aria-pressed={r.key === active?.key}
                  onClick={() => setSelected(r.key)}
                  title={`${instrumentLabel(r)} ${r.weightPct.toFixed(2)}%`}
                >
                  {rect.width >= 15 && rect.height >= 15 && <span>{instrumentLabel(r)}</span>}
                  {rect.width >= 12 && rect.height >= 12 && <small>{r.weightPct.toFixed(2)}%</small>}
                </button>
              );})}
            </div>
          )}
        </div>
        {workspace && rows.length > 0 && <section className={structureLayout.holdings} aria-label="보유 목록">
          <h3>보유 자산</h3>
          {rows.map(row => <button key={row.key} type="button" aria-pressed={row.key === active?.key} onClick={() => setSelected(row.key)}>
            <i aria-hidden style={{background:row.color}} /><span>{instrumentLabel(row)}<small>{row.account}</small></span>
            <strong>{formatAmount(row.amount)} <small>{context.currency}</small></strong><span>{row.weightPct.toFixed(2)}%</span>
          </button>)}
        </section>}
        <aside
          className={`${structureLayout.selected} ${evidence.surface} ${evidence.holdingEvidence}`}
        >
          <CairnSelect
            label="상세 종목 선택"
            value={active?.key ?? ""}
            options={rows.map((row) => ({
              value: row.key,
              label: (instrumentLabel(row)) + " · " + row.weightPct.toFixed(2) + "%",
            }))}
            onValueChange={setSelected}
            disabled={!active}
          />
          {active ? (
            <>
              <h3>{instrumentLabel(active)}</h3>
              {active.ticker && <p className={evidence.holdingIdentity}>{active.ticker}</p>}
              <p className={styles.muted}>
                {active.account ? `${view.domain ? "소유 계좌" : "가상 계좌"} ${active.account} · ` : ""}
                {active.currency ?? "통화 확인 필요"}
                {view.domain && <> · {activePriceTime.label} {activePriceTime.value ?? "미제공"}</>}
                {active.manuallyEntered && <> · 직접 입력한 가격</>}
              </p>
              <dl className={evidence.holdingFacts}>
                <div>
                  <dt>평가액</dt>
                  <dd>
                    {formatAmount(active.amount)} {context.currency}
                  </dd>
                </div>
                <div>
                  <dt>{composition && !composition.complete ? "확인된 소계 내 비중" : "현재 비중"}</dt>
                  <dd>{active.weightPct.toFixed(2)}%</dd>
                </div>
                <div>
                  <dt>목표 비중</dt>
                  <dd>
                    {(view.domain ? target?.effectiveTargetPct : active.targetPct)?.toFixed(2) ??
                      "—"}
                    %
                  </dd>
                </div>
                <div>
                  <dt>목표 편차</dt>
                  <dd>
                    {view.domain
                      ? driftNumber(target?.driftPct, 2)
                      : active.targetPct === null
                        ? "—"
                        : (active.weightPct - (active.targetPct ?? 0)).toFixed(2)}
                    %p
                  </dd>
                </div>
              </dl>
              {view.domain && (
                <p className={evidence.holdingNote}>
                  {target
                    ? "저장한 목표비중 기준"
                    : compositionRequested && currentRead?.kind === "tracked" ? "목표와의 차이는 목표비중 화면에서 확인하세요." : targetMessage(view)}
                </p>
              )}
              {!view.domain && (
                <>
                  <p className={styles.targetMeaning}>
                    현재 / 목표{" "}
                    <span>
                      {active.weightPct.toFixed(2)}% / {active.targetPct?.toFixed(2) ?? "—"}%
                    </span>
                  </p>
                  <div className={styles.targetTrack}>
                    <span style={{ width: `${active.weightPct}%` }} />
                    <i style={{ left: `${active.targetPct ?? 0}%` }} />
                  </div>
                </>
              )}
            </>
          ) : (
            <p className={styles.empty}>보유 종목 없음</p>
          )}
        </aside>
      </div>
      {view.domain && (
        <ActionGroup label="목표비중 더 살펴보기"><Link
          prefetch={false}
          href={betaReadHref(
            betaHref("/beta", context) + "#beta-target-drift",
            freshness?.store.pendingEpoch(),
          )}
          onNavigate={
            onTargetDrift
              ? (event) => {
                  event.preventDefault();
                  onTargetDrift();
                }
              : undefined
          }
        >
          <ActionContent icon={<Target size={22}/>} title="목표와 얼마나 달라졌을까요?" description="종목별 목표 편차 보기"/>
        </Link></ActionGroup>
      )}
    </>
  );
}
export function BetaDetail({
  kind,
  view,
  context,
  workspace = false,
  onContributionEdit,
  onContributionCalculate,
  onTargetDrift,
}: {
  kind: CardKind;
  view: FixtureView;
  context: BetaContext;
  workspace?: boolean;
  onContributionEdit?: (dirty: boolean) => void;
  onContributionCalculate?: (amount: string, keys?: string[]) => void;
  onTargetDrift?: () => void;
}) {
  const freshness = useBetaReadFreshness();
  const readHref = (href: string) => {
    const epoch = context.mode === "domain" ? freshness?.store.pendingEpoch() : undefined;
    return betaReadHref(href, epoch);
  };
  const headingRef = useRef<HTMLElement>(null);
  const focusTarget = kind === "drift" && !!onTargetDrift;
  useLayoutEffect(() => {
    if (focusTarget)
      headingRef.current
        ?.closest("dialog")
        ?.querySelector<HTMLButtonElement>("[data-dialog-close]")
        ?.focus({ preventScroll: true });
  }, [focusTarget]);
  const implemented = kind === "history" || kind === "structure";
  return (
    <section ref={headingRef} className={styles.detailContent} data-detail-kind={kind}>
      {!workspace && (
        <DetailHeader
          title={cardTitles[kind]}
          description={`${view.scopeLabel} · ${context.currency}`}
        />
      )}
      {kind === "history" ? (
        <HistoryDetail view={view} context={context} />
      ) : kind === "structure" ? (
        <StructureDetail workspace={workspace} view={view} context={context} onTargetDrift={onTargetDrift} />
      ) : view.domain && kind === "heatmap" ? (
        <HoldingHeatmap view={view} />
      ) : view.domain && kind === "simulation" ? (
        <div className={styles.pendingDetail}>
          <h3>현재 보유 연구</h3>
          <p>
            범위와 조건을 확인한 뒤 기존 연구를 명시적으로 실행합니다. 카드 열기만으로 계산하지
            않습니다.
          </p>
          <Link
            className={styles.continueLink}
            prefetch={false}
            href={readHref(betaHref("/beta/simulation", { ...context, run: undefined }))}
          >
            현재 보유 연구에서 실행 ↗
          </Link>
        </div>
      ) : view.domain && kind === "contribution" ? (
        <ContributionDetail
          view={view}
          context={context}
          onEdit={onContributionEdit}
          onCalculate={onContributionCalculate}
        />
      ) : view.domain && kind === "drift" ? (
        <TargetDetail view={view} />
      ) : view.domain && (kind === "value" || kind === "today") ? (
        <ReadSummary kind={kind} view={view} context={context} />
      ) : (
        <div className={styles.pendingDetail}>
          <h3>{view.domain ? "읽기 모델 미연결" : "개발용 미리보기"}</h3>
          <p>
            {view.domain
              ? "이 카드의 계산·정책 결과는 아직 연결하지 않았습니다."
              : "이번 단계는 홈 요약과 카드 확대 구조까지 구현했습니다."}
          </p>
          {view.domain ? (
            <p>
              과거 종목별 일일 흐름은 미연결입니다. 이 Preview에서는 기존 화면의 계산·편집·저장을
              실행하지 않습니다.
            </p>
          ) : (
            <>
              <p>이 기능의 계산·편집·저장은 기존 화면에서 계속할 수 있습니다.</p>
              <a className={styles.continueLink} href={originalHref(cardOriginals[kind], context)}>
                기존 화면에서 계속 ↗
              </a>
            </>
          )}
        </div>
      )}
      {!workspace && (
        <footer className={styles.detailFooter}>
          <span>{view.domain ? "보유·거래·목표를 변경하지 않는 조회 화면" : fixtureNotice}</span>
          {implemented && (
            <Link
              prefetch={context.mode === "domain" ? false : undefined}
              href={readHref(
                betaHref(
                  kind === "history" ? "/beta/history" : "/beta/portfolio/structure",
                  context,
                ),
              )}
            >
              해당 작업 화면에서 이어보기 ↗
            </Link>
          )}
        </footer>
      )}
    </section>
  );
}
