import { PortfolioText } from "@/components/portfolio/portfolio-text";
import { portfolioEnglish } from "@/components/portfolio/portfolio-copy";
import { LocalizedElement } from "@/components/i18n/localized-element";
import Link from "next/link";
import { ArrowUpRight, Target } from "lucide-react";
import { AdditionalContributionAllocationTable, AdditionalContributionFlowScene, AdditionalContributionWeightScene } from "./additional-contribution-result";
import { AdditionalContributionLogicDialog } from "./additional-contribution-logic-dialog";
import { ContributionCalculator, ContributionFundingVisual } from "./contribution-calculator";
import { PortfolioRefreshButton } from "@/components/home/portfolio-refresh-button";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";
import { buildPortfolioAnalysisScopeHref, type PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import styles from "./contribution-stage.module.css";

type BlockedPreview = Readonly<{ status: "blocked"; blockers: readonly string[] }>;

export function AdditionalContributionPageView({ amountKrw, enableLivePriceSync = true, generatedAt, preview, scopes, selectedScope }: {
  amountKrw: number;
  enableLivePriceSync?: boolean;
  generatedAt: string;
  preview: AdditionalContributionResultPreview | BlockedPreview;
  scopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  const designQuery = enableLivePriceSync ? {} : { preview: "design" };
  return (
    <main className="varda-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]" data-page="additional-contribution" data-preview-status={preview.status}>
      <PortfolioPrimaryNavigation activePath="/additional-contribution" generatedAt={generatedAt} selectedScopeKey={selectedScope.key} />
      <div className={`varda-content varda-stage-content ${styles.page}`}>
        <header className={styles.header}>
          <div className={styles.title}><h1 id="additional-contribution-title"><PortfolioText ko={"다음 투입의 균형."} /></h1>{!enableLivePriceSync ? <LocalizedElement className={styles.previewNote} title="실제 보유자산과 연결되지 않은 디자인 미리보기입니다." as="span" en={{"title": portfolioEnglish("실제 보유자산과 연결되지 않은 디자인 미리보기입니다.")}}><PortfolioText ko={"예시 데이터"} /></LocalizedElement> : null}</div>
          <div className={styles.scopeBar}><PortfolioAnalysisScopeTabs basePath="/additional-contribution" query={{ amount: String(amountKrw), ...designQuery }} scopes={scopes} selectedScopeKey={selectedScope.key} variant="underline" /></div>
          <div className={styles.headerActions}>{enableLivePriceSync ? <PortfolioRefreshButton autoSync /> : null}<Link className={styles.textLink} href={buildPortfolioAnalysisScopeHref("/portfolio/targets", selectedScope.key)} title="목표비중 설정"><Target size={16} aria-hidden="true" /><span><PortfolioText ko={"목표비중"} /></span><ArrowUpRight size={13} aria-hidden="true" /></Link></div>
        </header>
        <ContributionCalculator amountKrw={amountKrw} scopeKey={selectedScope.key} isDesignPreview={!enableLivePriceSync} status={preview.status} allocations={preview.status === "ready" ? <FeaturedAllocation preview={preview} /> : undefined}>
          {preview.status === "ready" ? <ContributionFundingVisual cash={preview.cashAmountKrw} trims={preview.totalTrimProceedsKrw} total={preview.totalAvailableFundsKrw} residual={preview.residualCashKrw} rows={preview.rows.map((row, index) => ({ key: row.allocationKey ?? `${row.accountCode}:${row.ticker ?? row.name}:${index}`, name: row.name, amount: row.allocationKrw }))} /> : <div className={styles.waitingVisual}><span><PortfolioText ko={"배분의 시작은 목표비중에서"} /></span><strong><PortfolioText ko={"계산 근거를"} /><br /><PortfolioText ko={"확인해 주세요."} /></strong><p><PortfolioText ko={preview.blockers[0] ? blockerLabel(preview.blockers[0]) : "현재 배분안을 계산할 수 없습니다."} /></p></div>}
        </ContributionCalculator>
        <footer className={styles.footer}>
          {preview.status === "ready" ? <>
            <dl className={styles.footerNumbers}><div><dt><PortfolioText ko={"총 매수"} /></dt><dd>{formatKrw(preview.totalAllocatedKrw)}</dd></div><div><dt><PortfolioText ko={"남는 현금"} /></dt><dd>{formatKrw(preview.residualCashKrw)}</dd></div></dl>
            <div className={styles.detailActions}>
              <PresentationDialog label={`전체 ${preview.rows.length}종목 배분`} labelEn={portfolioEnglish(`전체 ${preview.rows.length}종목 배분`)} title="종목별 전체 배분안" titleEn={portfolioEnglish("종목별 전체 배분안")} description={`현재 평가액 ${formatKrw(preview.currentPortfolioTotalKrw)} · ${preview.policyLabel} · 가격 기준일 ${preview.serviceDate}`} descriptionEn={portfolioEnglish(`현재 평가액 ${formatKrw(preview.currentPortfolioTotalKrw)} · ${preview.policyLabel} · 가격 기준일 ${preview.serviceDate}`)} wide><AdditionalContributionAllocationTable preview={preview} /><p className={styles.modalNote}><PortfolioText ko={"목표 부족분과 MA120 근거를 반영한 계산입니다. 남는 재원은 현금으로 유지됩니다. MA120"} />{" "}<PortfolioText ko={preview.ma120Evidence.mode === "off" ? "미적용" : `${preview.ma120Evidence.usableCount}/${preview.rows.length}종목 근거 확보${preview.ma120Evidence.status === "ready" ? "" : " · 일부 근거 부족"}`} />.</p><Link className={styles.textLink} href={buildPortfolioAnalysisScopeHref("/portfolio/holdings", selectedScope.key)}><PortfolioText ko={"보유 종목 관리"} />{" "}<ArrowUpRight size={13} aria-hidden="true" /></Link></PresentationDialog>
              <AdditionalContributionLogicDialog preview={preview} />
              <PresentationDialog label="비중·자금 흐름" labelEn={portfolioEnglish("비중·자금 흐름")} title="추가투입 전후 변화" titleEn={portfolioEnglish("추가투입 전후 변화")} wide><AdditionalContributionWeightScene preview={preview} /><AdditionalContributionFlowScene preview={preview} /></PresentationDialog>
            </div>
          </> : <><span className={styles.modalNote}><PortfolioText ko={"계산 결과만 제공하며 실제 주문은 실행하지 않습니다."} /></span><PresentationDialog label="계산 근거 확인" labelEn={portfolioEnglish("계산 근거 확인")} title="배분안을 계산할 수 없는 이유" titleEn={portfolioEnglish("배분안을 계산할 수 없는 이유")} wide><BlockedPreview blockers={preview.blockers} /></PresentationDialog></>}
        </footer>
      </div>
    </main>
  );
}

function FeaturedAllocation({ preview }: { preview: AdditionalContributionResultPreview }) {
  const ranked = preview.rows.filter(row => row.action !== "hold").toSorted((a,b) => Math.max(b.allocationKrw,b.trimAmountKrw) - Math.max(a.allocationKrw,a.trimAmountKrw));
  const featured = ranked.slice(0,4);
  return <div className={styles.featured}>
    <div className={styles.featuredHeading}><span>ALLOCATION</span><h2><PortfolioText ko={"주요 배분"} /></h2><p><PortfolioText ko={"금액 순"} />{" "}{featured.length}<PortfolioText ko={"종목 · 전체"} />{" "}{preview.rows.length}<PortfolioText ko="종목" en=" holdings" /></p></div>
    <ul>{featured.map((row,index) => <li key={row.allocationKey ?? `${row.accountCode}:${row.ticker ?? row.name}:${index}`}><div><strong>{row.name}</strong><span>{row.accountName} · {row.currentWeightPct.toFixed(1)}% → {row.postTopupWeightPct.toFixed(1)}%</span></div><p data-action={row.action}><small><PortfolioText ko={row.action === "trim" ? "매도" : "매수"} /></small>{formatKrw(row.action === "trim" ? row.trimAmountKrw : row.allocationKrw)}</p></li>)}</ul>
    {featured.length === 0 ? <p className={styles.modalNote}><PortfolioText ko={"계산된 매수·매도 종목이 없습니다. 재원은 현금으로 유지합니다."} /></p> : null}
  </div>;
}
function BlockedPreview({ blockers }: { blockers: readonly string[] }) {
  return (
    <section
      className="border-y border-[var(--line)] py-12"
      aria-labelledby="blocked-title"
    >
      <p className="text-[11px] font-medium text-[var(--muted)]">CALCULATION STATUS</p>
      <h2 id="blocked-title" className="mt-2 text-2xl font-medium">
        <PortfolioText ko={"지금은 배분안을 계산할 수 없습니다"} />{" "}</h2>
      <ul className="mt-6 max-w-3xl divide-y divide-[var(--wash)] border-y border-[var(--line)] text-sm text-[var(--warning)]">
        {blockers.map((blocker) => (
          <li key={blocker} className="py-4">
            <PortfolioText ko={blockerLabel(blocker)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function blockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    portfolio_target_policy_missing:
      "이 범위에 저장된 목표비중이 없습니다. 목표비중 화면에서 먼저 설정해 주세요.",
    portfolio_target_policy_conflict:
      "현재 목표비중 승인본이 하나로 확정되지 않았습니다.",
    portfolio_target_policy_universe_changed:
      "목표비중을 저장한 뒤 보유종목 구성이 바뀌었습니다. 목표비중을 다시 확인해 주세요.",
    portfolio_target_policy_not_effective:
      "저장된 목표비중의 적용 시작일 전입니다.",
    portfolio_target_policy_integrity_error:
      "저장된 목표비중의 무결성을 확인할 수 없습니다.",
    valuation_universe_invalid:
      "현재 범위의 보유종목 구성을 계산에 사용할 수 없습니다.",
    target_policy_missing: "이 계정에 승인된 목표비중이 없습니다.",
    target_policy_conflict: "승인된 목표비중 상태가 충돌합니다.",
    target_policy_not_effective: "목표비중의 적용 시작일 전입니다.",
    target_policy_universe_mismatch:
      "현재 보유 종목과 승인된 목표비중의 종목 구성이 다릅니다.",
    target_policy_vector_mismatch: "승인된 목표비중 해시가 일치하지 않습니다.",
    target_policy_total_invalid: "목표비중 합계가 100%가 아닙니다.",
    target_policy_instrument_unbuyable: "매수할 수 없는 목표 종목이 있습니다.",
    valuation_account_mismatch: "현재 평가액의 계정 범위가 일치하지 않습니다.",
    valuation_identity_missing: "일부 목표 종목의 현재 평가액이 없습니다.",
    valuation_identity_duplicate: "현재 평가액 종목 식별자가 중복되었습니다.",
    invalid_cash_amount: "투입 금액은 1원 이상의 정수여야 합니다.",
    empty_valuation_universe: "계산에 사용할 보유 평가액이 없습니다.",
    invalid_current_value: "일부 종목의 평가액이 없거나 유효하지 않습니다.",
    invalid_cost_basis: "일부 종목의 매입원가 값이 유효하지 않습니다.",
    invalid_target_weight: "목표비중은 0~100% 범위여야 합니다.",
    target_policy_incomplete: "선택 범위의 목표비중 합계가 100%가 아닙니다.",
    duplicate_allocation_key: "같은 종목의 보유 식별자가 중복되어 계산을 중단했습니다.",
    invalid_policy_parameter: "매도 기준이나 집행 참고비율이 유효하지 않습니다.",
    allocation_invariant_failed: "금액 합계와 원 단위 배분을 검증하지 못했습니다.",
    unallocatable_target_deficit:
      "부족 비중을 매수 가능한 종목에 배분할 수 없습니다.",
  };
  return labels[blocker] ?? `데이터 검증 실패: ${blocker}`;
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}
