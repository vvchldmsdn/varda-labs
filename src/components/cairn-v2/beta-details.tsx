"use client";
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

function StructureDetail({
  view,
  context,
  onTargetDrift,
}: {
  view: FixtureView;
  context: BetaContext;
  onTargetDrift?: () => void;
}) {
  const freshness = useBetaReadFreshness();
  const displayMoney = (n: number | null, c: BetaContext["currency"], signed = false) =>
    displayReadMoney(view, n, c, signed);
  const { selected, setSelected, structureView, setStructureView } = useBetaPreferences();
  const stateText = readStateText(view.domain?.valueState, "보유 종목 없음");
  if (stateText)
    return (
      <p className={styles.empty} role="status">
        {stateText}
      </p>
    );
  const active = view.rows.find((r) => r.key === selected) ?? view.rows[0];
  const mapRows = new Map(view.rows.map(row => [row.key, row]));
  const mapRects = structureView === "map"
    ? layoutPortfolioTreemap(view.rows.map(row => ({ key: row.key, value: row.weightPct })), 100, 100)
    : [];
  const target =
    view.domain?.planning?.targets.state === "ready"
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
      {view.domain && view.domain.excluded.length > 0 && (
        <p className={styles.muted}>
          확인 가능한 소계 {displayMoney(view.domain.knownSubtotalKrw, context.currency)}{" "}
          {context.currency} · 소계 내 비중 · 제외 {view.domain.excluded.length}종목
        </p>
      )}
      {!!view.domain?.excluded.length && <details className={structureLayout.exclusions}><summary>제외 종목 확인</summary>{view.domain.excluded.map((r, i) => (
        <p key={i} className={styles.muted}>
          제외: {r.name} · {r.currency} · {r.reason}
        </p>
      ))}</details>}
      <div className={structureLayout.layout}>
        <aside className={structureLayout.summary}>
          <p className={styles.muted}>
            {view.domain?.excluded.length
              ? "전체 합계 확인 전"
              : view.domain
                ? "전체 투자자산 평가액"
                : "전체 자산 평가액"}
          </p>
          <p className={structureLayout.total}>
            {displayMoney(view.rows.length ? view.totalKrw : null, context.currency)}{" "}
            {context.currency === "KRW" ? "원" : "USD"}
          </p>
          <p className={styles.muted}>보유 종목</p>
          <p>{view.rows.length}개</p>
          <p className={styles.muted}>목표비중</p>
          <p>{view.domain ? targetMessage(view) : view.rows.length ? "가상 설정됨" : "없음"}</p>
        </aside>
        <div className={structureLayout.visual}>
          {structureView === "ring" ? (
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
                  aria-label={`${r.name} ${r.weightPct.toFixed(2)}%`}
                  aria-pressed={r.key === active?.key}
                  onClick={() => setSelected(r.key)}
                  title={`${r.ticker ?? r.name} ${r.weightPct.toFixed(2)}%`}
                >
                  {rect.width >= 15 && rect.height >= 15 && <span>{r.ticker ?? r.name}</span>}
                  {rect.width >= 12 && rect.height >= 12 && <small>{r.weightPct.toFixed(2)}%</small>}
                </button>
              );})}
            </div>
          )}
        </div>
        <aside
          className={`${structureLayout.selected} ${evidence.surface} ${evidence.holdingEvidence}`}
        >
          <CairnSelect
            label="상세 종목 선택"
            value={active?.key ?? ""}
            options={view.rows.map((row) => ({
              value: row.key,
              label: (row.ticker ?? row.name) + " · " + row.weightPct.toFixed(2) + "%",
            }))}
            onValueChange={setSelected}
            disabled={!active}
          />
          {active ? (
            <>
              <h3>{active.name}</h3>
              <p className={evidence.holdingIdentity}>{active.ticker ?? active.key}</p>
              <p className={styles.muted}>
                {view.domain ? "소유 계좌" : "가상 계좌"} {active.account} ·{" "}
                {active.currency ?? "USD"}
                {view.domain && <> · 가격 관측 {active.priceAsOf ?? "미제공"}</>}
              </p>
              <dl className={evidence.holdingFacts}>
                <div>
                  <dt>평가액</dt>
                  <dd>
                    {displayMoney(active.valueKrw, context.currency)} {context.currency}
                  </dd>
                </div>
                <div>
                  <dt>현재 비중</dt>
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
                    : targetMessage(view)}
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
        <StructureDetail view={view} context={context} onTargetDrift={onTargetDrift} />
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
