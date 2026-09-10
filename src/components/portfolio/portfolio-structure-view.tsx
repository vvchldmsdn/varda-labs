import { PortfolioText } from "@/components/portfolio/portfolio-text";
import { portfolioEnglish } from "@/components/portfolio/portfolio-copy";
import { LocalizedElement } from "@/components/i18n/localized-element";
import { LocalizedLink } from "@/components/i18n/localized-link";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import styles from "../portfolio-structure/structure-stage.module.css";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import { DirectHoldingsBaseline } from "@/components/portfolio/direct-holdings-baseline";
import { PortfolioAllocationExplorer } from "@/components/portfolio/portfolio-allocation-explorer";
import { PortfolioFxShock } from "@/components/portfolio/portfolio-fx-shock";
import { PortfolioStructureRiskAnalytics } from "@/components/portfolio/portfolio-structure-risk-analytics";
import { SpecialHoldingsCoverage } from "@/components/portfolio/special-holdings-coverage";
import type { PortfolioDirectHoldingsBaseline } from "@/lib/portfolio-direct-holdings";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { PortfolioSpecialHoldingsModel } from "@/lib/portfolio-special-holdings";
import type { PortfolioRiskReadModel } from "@/lib/portfolio-risk-read-model";
import type {
  PortfolioStructureExclusion,
  PortfolioStructureHoldingRow,
  PortfolioStructureResult,
} from "@/lib/portfolio-structure";
import type { PortfolioStructureTargetProjection } from "@/lib/portfolio-structure-target-policy";

export type PortfolioStructureViewData = Readonly<{
  analysisScopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
  generatedAt: string;
  serviceDate: string | null;
  structure: PortfolioStructureResult;
  targetProjection: Omit<PortfolioStructureTargetProjection, "structure">;
  targetEffectiveServiceDate: string | null;
  directHoldingsBaseline: PortfolioDirectHoldingsBaseline;
  specialHoldingsCoverage: PortfolioSpecialHoldingsModel;
  riskModel: PortfolioRiskReadModel;
  isDesignPreview?: boolean;
}>;

export function PortfolioStructureView({data}:{data:PortfolioStructureViewData}) {
  const accountLabels: Readonly<Record<string, string>> = Object.fromEntries(
    data.analysisScopes.flatMap(scope => scope.kind === "account" ? [[scope.accountCode, scope.label]] : []),
  );
  const policyStatus=policyStatusLabel(data.targetProjection.status);
  const policyDetail=policyStatusDetail({effectiveServiceDate:data.targetEffectiveServiceDate,projection:data.targetProjection});
  const riskPortfolio=data.riskModel.calculation.portfolio;
  const summary=<div className={styles.coreSummary}><div className={styles.total}><span><PortfolioText ko={data.selectedScope.label} en={data.selectedScope.key === "all" ? "All assets" : data.selectedScope.label} /> {" "}<PortfolioText ko={"평가액"} /></span><strong>{formatKrw(data.structure.totalValueKrw)}</strong></div><dl className={styles.overviewMetrics}><HeroMetric label="보유 종목" value={`${data.structure.includedHoldingCount}개`}/><HeroMetric label="유효 분산 수 ENB" value={riskPortfolio?formatNumber(riskPortfolio.riskContributionEnb.value,2):"근거 부족"}/><HeroMetric label="목표비중" value={policyStatus}/></dl></div>;
  const details=<>
    <PresentationDialog label="위험 분석" labelEn={portfolioEnglish("위험 분석")} title="상관·분산·베타 분석" titleEn={portfolioEnglish("상관·분산·베타 분석")} wide><dl className={styles.riskMetrics}><RailMetric label="Sharpe" value={riskPortfolio?formatNumber(riskPortfolio.sharpe.value,2):"근거 부족"} detail="위험 대비 수익 · 무위험 수익률 가정 포함"/><RailMetric label="평균 상관" value={riskPortfolio?formatNumber(riskPortfolio.weightedAverageCorrelation.value,2):"근거 부족"} detail="종목들이 함께 움직이는 정도"/><RailMetric label="하락 구간 상관" value={riskPortfolio?formatNumber(riskPortfolio.stress.weightedAverageCorrelation.value,2):"근거 부족"} detail="하락일에 관측한 동반 움직임"/><RailMetric label="최대 낙폭" value={data.riskModel.pathAnalytics.maximumDrawdownPct.value===null?"근거 부족":formatRiskPercent(data.riskModel.pathAnalytics.maximumDrawdownPct.value)} detail="분석 기간 고점 대비 최대 하락"/></dl><PortfolioStructureRiskAnalytics model={data.riskModel} scopeKey={data.selectedScope.key} totalHoldingCount={data.structure.includedHoldingCount} isDesignPreview={data.isDesignPreview}/><Link className={styles.headerLink} href={`/portfolio/risk?scope=${encodeURIComponent(data.selectedScope.key)}${data.isDesignPreview?"&preview=design":""}`}><PortfolioText ko={"종목별 위험과 데이터 근거"} />{" "}<ArrowRight size={13} aria-hidden="true"/></Link></PresentationDialog>
    <PresentationDialog label="보유 근거" labelEn={portfolioEnglish("보유 근거")} title="보유 종목과 데이터 근거" titleEn={portfolioEnglish("보유 종목과 데이터 근거")} wide><p className={styles.evidenceNote}><PortfolioText ko={policyDetail} /> · <PortfolioText ko={dataHealthDetail(data.structure)} /><br/>USD/KRW {formatNumber(data.structure.usdKrwRate,2)} {" "}<PortfolioText ko={"· 기준일"} />{" "}{formatDate(data.serviceDate)} {" "}<PortfolioText ko={"· 읽기 전용 분석"} /></p><HoldingEvidenceTable rows={data.structure.holdingRows} accountLabels={accountLabels}/>{data.structure.exclusions.length?<section className={styles.modalSection}><h3><PortfolioText ko={"평가 제외"} />{" "}{data.structure.exclusions.length}<PortfolioText ko={"행"} /></h3><ExclusionTable rows={data.structure.exclusions} accountLabels={accountLabels}/></section>:null}</PresentationDialog>
    <PresentationDialog label="집중·환율" labelEn={portfolioEnglish("집중·환율")} title="집중도와 환율 노출" titleEn={portfolioEnglish("집중도와 환율 노출")} wide><DirectHoldingsBaseline model={data.directHoldingsBaseline} scopeLabel={data.selectedScope.label}/><div className={styles.modalSection}><PortfolioFxShock baseline={data.directHoldingsBaseline} currentUsdKrwRate={data.structure.usdKrwRate}/></div><div className={styles.modalSection}><SpecialHoldingsCoverage model={data.specialHoldingsCoverage}/></div></PresentationDialog>
  </>;
  return <main className="varda-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]" data-page="portfolio-structure">
    <PortfolioPrimaryNavigation activePath="/portfolio/structure" generatedAt={data.generatedAt} selectedScopeKey={data.selectedScope.key}/>
    <div className={`varda-content varda-stage-content ${styles.page}`}>
      <header className={styles.header}><div className={styles.title}><h1 id="portfolio-structure-title"><PortfolioText ko={"내 포트의 구조."} /></h1>{data.isDesignPreview?<LocalizedElement className={styles.previewNote} title="실제 보유자산과 연결되지 않은 디자인 미리보기입니다." as="span" en={{"title": portfolioEnglish("실제 보유자산과 연결되지 않은 디자인 미리보기입니다.")}}><PortfolioText ko={"예시 데이터"} /></LocalizedElement>:null}</div><div className={styles.scopeBar}><PortfolioAnalysisScopeTabs basePath="/portfolio/structure" scopes={data.analysisScopes} selectedScopeKey={data.selectedScope.key} query={data.isDesignPreview?{preview:"design"}:undefined} variant="underline"/></div><LocalizedLink className={styles.headerLink} href={`/portfolio/targets?scope=${encodeURIComponent(data.selectedScope.key)}`} title="목표비중 설정" aria-label="목표비중 설정" en={{ title: portfolioEnglish("목표비중 설정"), "aria-label": portfolioEnglish("목표비중 설정") }}><span><PortfolioText ko={"목표비중"} /></span><ArrowUpRight size={15} aria-hidden="true"/></LocalizedLink></header>
      <LocalizedElement className={styles.allocation} aria-label="자산 배분 구성" as="section" en={{"aria-label": portfolioEnglish("자산 배분 구성")}}><PortfolioAllocationExplorer compact groupRows={data.structure.groupRows} holdingRows={data.structure.holdingRows} accountLabels={accountLabels} summary={summary} footer={details} serviceDate={data.serviceDate}/></LocalizedElement>
    </div>
  </main>;
}
function HoldingEvidenceTable({
  rows,
  accountLabels,
}: {
  rows: readonly PortfolioStructureHoldingRow[];
  accountLabels: Readonly<Record<string, string>>;
}) {
  return (
    <div className="overflow-x-auto pb-4">
      <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-[11px] text-[var(--muted)]">
          <tr>
            <TableHeader><PortfolioText ko={"종목"} /></TableHeader>
            <TableHeader><PortfolioText ko={"계정"} /></TableHeader>
            <TableHeader><PortfolioText ko={"그룹"} /></TableHeader>
            <TableHeader align="right"><PortfolioText ko={"수량"} /></TableHeader>
            <TableHeader align="right"><PortfolioText ko={"현재가"} /></TableHeader>
            <TableHeader align="right"><PortfolioText ko={"평가액"} /></TableHeader>
            <TableHeader align="right"><PortfolioText ko={"현재 비중"} /></TableHeader>
            <TableHeader align="right"><PortfolioText ko={"목표 비중"} /></TableHeader>
            <TableHeader align="right"><PortfolioText ko={"편차"} /></TableHeader>
            <TableHeader><PortfolioText ko={"가격 근거"} /></TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.account}-${row.market}-${row.ticker ?? row.name}-${index}`}>
              <TableCell strong>
                <div>{row.name}</div>
                <div className="mt-1 text-[11px] font-normal text-[var(--muted)]">
                  {row.ticker ?? <PortfolioText ko="종목 코드 없음" />} · {row.market.toUpperCase()} · {row.currency}
                </div>
              </TableCell>
              <TableCell><PortfolioText ko={accountLabel(row.account, accountLabels)} /></TableCell>
              <TableCell>{row.groupName === "Ungrouped" ? <PortfolioText ko="미분류" /> : row.groupName}</TableCell>
              <TableCell align="right">{formatNumber(row.quantity, 4)}</TableCell>
              <TableCell align="right">{formatNumber(row.currentPrice, 2)}</TableCell>
              <TableCell align="right">{formatKrw(row.currentValueKrw)}</TableCell>
              <TableCell align="right">{formatPercent(row.currentWeightPct)}</TableCell>
              <TableCell align="right"><PortfolioText ko={formatPercent(row.effectiveTargetPct)} /></TableCell>
              <TableCell align="right">{formatSignedPercent(row.driftPct)}</TableCell>
              <TableCell>
                <div><PortfolioText ko={priceEvidenceLabel(row.priceEvidenceSource)} /></div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">{row.priceSource ?? "-"}</div>
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExclusionTable({ rows, accountLabels }: { rows: readonly PortfolioStructureExclusion[]; accountLabels: Readonly<Record<string, string>> }) {
  return (
    <div className="overflow-x-auto pb-4">
      <table className="w-full min-w-[850px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-[11px] text-[var(--muted)]">
          <tr>
            <TableHeader><PortfolioText ko={"종목"} /></TableHeader>
            <TableHeader><PortfolioText ko={"계정"} /></TableHeader>
            <TableHeader><PortfolioText ko={"그룹"} /></TableHeader>
            <TableHeader><PortfolioText ko={"제외 이유"} /></TableHeader>
            <TableHeader align="right"><PortfolioText ko={"수량"} /></TableHeader>
            <TableHeader align="right"><PortfolioText ko={"가격"} /></TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.reason}-${row.account}-${row.ticker ?? row.name}-${index}`}>
              <TableCell strong>
                <div>{row.name}</div>
                <div className="mt-1 text-[11px] font-normal text-[var(--muted)]">
                  {row.ticker ?? <PortfolioText ko="종목 코드 없음" />}
                </div>
              </TableCell>
              <TableCell><PortfolioText ko={accountLabel(row.account, accountLabels)} /></TableCell>
              <TableCell>{row.groupName === "Ungrouped" ? <PortfolioText ko="미분류" /> : row.groupName}</TableCell>
              <TableCell><PortfolioText ko={exclusionReasonLabel(row.reason)} /></TableCell>
              <TableCell align="right">{formatNumber(row.quantity, 4)}</TableCell>
              <TableCell align="right">{formatNumber(row.currentPrice, 2)}</TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeroMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className={styles.overviewMetric}>
      <dt><PortfolioText ko={label} /></dt>
      <dd title={value}><PortfolioText ko={value} /></dd>
    </div>
  );
}

function RailMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={styles.riskMetric}>
      <dt><PortfolioText ko={label} /></dt>
      <dd title={value}><PortfolioText ko={value} /><span><PortfolioText ko={detail} /></span></dd>
    </div>
  );
}

function TableHeader({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <th
      className={`border-b border-[var(--line)] px-3 py-3 font-medium ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function TableCell({
  align = "left",
  children,
  strong = false,
}: {
  align?: "left" | "right";
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-b border-[var(--wash)] px-3 py-3 align-top ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-medium" : ""}`}
    >
      {children}
    </td>
  );
}

function dataHealthDetail(structure: PortfolioStructureResult) {
  const reasons = [
    structure.dataHealth.missingPriceCount > 0
      ? `가격 없음 ${structure.dataHealth.missingPriceCount}`
      : null,
    structure.dataHealth.missingFxCount > 0
      ? `환율 없음 ${structure.dataHealth.missingFxCount}`
      : null,
    structure.dataHealth.unsupportedCurrencyCount > 0
      ? `미지원 통화 ${structure.dataHealth.unsupportedCurrencyCount}`
      : null,
  ].filter(Boolean);
  return reasons.length > 0 ? reasons.join(" · ") : "현재 평가 제외 근거 없음";
}

function policyStatusLabel(status: PortfolioStructureTargetProjection["status"]) {
  if (status === "applied") return "승인 정책 적용";
  if (status === "partial") return "일부 연결";
  if (status === "invalid") return "검증 필요";
  return "정책 없음";
}

function policyStatusDetail({
  effectiveServiceDate,
  projection,
}: {
  effectiveServiceDate: string | null;
  projection: Omit<PortfolioStructureTargetProjection, "structure">;
}) {
  if (projection.status === "applied") {
    return `${formatDate(effectiveServiceDate)} · ${projection.coverage.matchedHoldingCount}/${projection.coverage.policyTargetCount} 종목 연결`;
  }
  if (projection.status === "partial") {
    return `${projection.coverage.matchedHoldingCount}/${projection.coverage.policyTargetCount} 종목만 연결`;
  }
  if (projection.status === "invalid") return "목표비중 매핑 검증 필요";
  return "현재 범위에 승인된 목표비중 없음";
}

function accountLabel(account: string, labels: Readonly<Record<string, string>>) {
  if (Object.hasOwn(labels, account)) return labels[account];
  if (account === "brokerage") return "증권";
  if (account === "isa") return "ISA";
  if (account === "irp") return "IRP";
  return account;
}


function priceEvidenceLabel(source: PortfolioStructureHoldingRow["priceEvidenceSource"]) {
  return source === "live_price_quote" ? "실시간 시세" : "저장 가격";
}

function exclusionReasonLabel(reason: PortfolioStructureExclusion["reason"]) {
  if (reason === "missing_price") return "가격 없음";
  if (reason === "missing_fx") return "환율 없음";
  return "미지원 통화";
}

function formatKrw(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number | null, maximumFractionDigits: number) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("ko-KR", { maximumFractionDigits });
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "목표 없음";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function formatRiskPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%p`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}
