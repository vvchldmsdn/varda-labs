import type { ReactNode } from "react";

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
}>;

export function PortfolioStructureView({
  data,
}: {
  data: PortfolioStructureViewData;
}) {
  const policyStatus = policyStatusLabel(data.targetProjection.status);
  const policyDetail = policyStatusDetail({
    effectiveServiceDate: data.targetEffectiveServiceDate,
    projection: data.targetProjection,
  });
  const riskPortfolio = data.riskModel.calculation.portfolio;

  return (
    <main
      className="varda-page varda-presentation-page bg-[var(--paper)] text-[var(--ink)]"
      data-page="portfolio-structure"
    >
      <PortfolioPrimaryNavigation
        activePath="/portfolio/structure"
        generatedAt={data.generatedAt}
        selectedScopeKey={data.selectedScope.key}
      />

      <div className="varda-content varda-presentation-content">
        <div className="varda-screen">
          <header className="varda-screen-header">
            <div className="varda-screen-heading">
              <div className="varda-screen-title-row">
                <div>
                  <p className="varda-kicker">PORTFOLIO / STRUCTURE</p>
                  <h1 className="varda-page-title" id="portfolio-structure-title">포트 구조</h1>
                </div>
                <p className="text-xs text-[var(--muted)]">기준일 {formatDate(data.serviceDate)}</p>
              </div>
            </div>
            <div className="varda-screen-scope">
              <PortfolioAnalysisScopeTabs
                basePath="/portfolio/structure"
                scopes={data.analysisScopes}
                selectedScopeKey={data.selectedScope.key}
                variant="underline"
              />
            </div>
          </header>

          <section className="varda-hero-strip" aria-labelledby="portfolio-structure-title">
            <div className="varda-hero-value">
              <span className="text-xs font-medium text-[var(--muted)]">{data.selectedScope.label} 현재 평가액</span>
              <strong>{formatKrw(data.structure.totalValueKrw)}</strong>
            </div>
            <dl className="varda-hero-metrics">
              <HeroMetric label="보유 종목" value={`${data.structure.includedHoldingCount}개`} />
              <HeroMetric
                label="유효 분산 수 ENB"
                value={riskPortfolio ? formatNumber(riskPortfolio.riskContributionEnb.value, 2) : "계산 대기"}
              />
              <HeroMetric label="목표 정책" value={policyStatus} />
            </dl>
          </section>

          <div className="varda-workspace-grid">
            <div className="varda-main-visual varda-structure-main">
              <PortfolioAllocationExplorer
                compact
                groupRows={data.structure.groupRows}
                holdingRows={data.structure.holdingRows}
              />
            </div>

            <aside className="varda-context-rail" aria-label="포트 구조 핵심 지표와 상세 분석">
              <section className="varda-rail-section">
                <p className="varda-kicker">RISK SNAPSHOT</p>
                <h2 className="mt-1 text-sm font-medium">위험 지형 요약</h2>
                <dl className="varda-rail-metrics mt-3">
                  <RailMetric label="Sharpe" value={riskPortfolio ? formatNumber(riskPortfolio.sharpe.value, 2) : "-"} />
                  <RailMetric label="평균 상관" value={riskPortfolio ? formatNumber(riskPortfolio.weightedAverageCorrelation.value, 2) : "-"} />
                  <RailMetric label="스트레스 상관" value={riskPortfolio ? formatNumber(riskPortfolio.stress.weightedAverageCorrelation.value, 2) : "-"} />
                  <RailMetric label="최대 낙폭" value={formatRiskPercent(data.riskModel.pathAnalytics.maximumDrawdownPct.value)} />
                </dl>
                <div className="mt-4">
                  <PresentationDialog label="위험 분석 전체 보기" title="상관·분산·베타 분석" wide>
                    <PortfolioStructureRiskAnalytics
                      model={data.riskModel}
                      scopeKey={data.selectedScope.key}
                      totalHoldingCount={data.structure.includedHoldingCount}
                    />
                  </PresentationDialog>
                </div>
              </section>

              <section className="varda-rail-section">
                <p className="varda-kicker">STRUCTURE DETAILS</p>
                <h2 className="mt-1 text-sm font-medium">구조를 다른 각도로 보기</h2>
                <div className="mt-4 grid gap-2">
                  <PresentationDialog label="직접 보유 집중도" title="직접 보유 기준선" wide>
                    <DirectHoldingsBaseline model={data.directHoldingsBaseline} scopeLabel={data.selectedScope.label} />
                  </PresentationDialog>
                  <PresentationDialog label="환율 충격" title="USD/KRW 충격 시나리오" wide>
                    <PortfolioFxShock baseline={data.directHoldingsBaseline} currentUsdKrwRate={data.structure.usdKrwRate} />
                  </PresentationDialog>
                  <PresentationDialog label="특수 자산" title="특수 자산 분석 커버리지" wide>
                    <SpecialHoldingsCoverage model={data.specialHoldingsCoverage} />
                  </PresentationDialog>
                </div>
              </section>

              <section className="varda-rail-section">
                <p className="text-[10px] leading-4 text-[var(--faint)]" title={policyDetail}>{policyDetail}</p>
                <p className="mt-2 text-[10px] leading-4 text-[var(--faint)]">{dataHealthDetail(data.structure)}</p>
              </section>
            </aside>
          </div>

          <footer className="varda-screen-footer">
            <div className="varda-inline-actions">
              <PresentationDialog label={`보유 원자료 ${data.structure.holdingRows.length}행`} title="보유 종목 원자료" wide>
                <HoldingEvidenceTable rows={data.structure.holdingRows} />
              </PresentationDialog>
              {data.structure.exclusions.length > 0 ? (
                <PresentationDialog label={`평가 제외 ${data.structure.exclusions.length}행`} title="평가 제외 근거" wide>
                  <ExclusionTable rows={data.structure.exclusions} />
                </PresentationDialog>
              ) : null}
            </div>
            <p>USD/KRW {formatNumber(data.structure.usdKrwRate, 2)} · 읽기 전용 · 추천·주문 아님</p>
          </footer>
        </div>
      </div>
    </main>
  );
}

function HoldingEvidenceTable({
  rows,
}: {
  rows: readonly PortfolioStructureHoldingRow[];
}) {
  return (
    <div className="overflow-x-auto pb-4">
      <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-[11px] text-[var(--muted)]">
          <tr>
            <TableHeader>종목</TableHeader>
            <TableHeader>계정</TableHeader>
            <TableHeader>그룹</TableHeader>
            <TableHeader align="right">수량</TableHeader>
            <TableHeader align="right">현재가</TableHeader>
            <TableHeader align="right">평가액</TableHeader>
            <TableHeader align="right">현재 비중</TableHeader>
            <TableHeader align="right">목표 비중</TableHeader>
            <TableHeader align="right">편차</TableHeader>
            <TableHeader>가격 근거</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.account}-${row.market}-${row.ticker ?? row.name}-${index}`}>
              <TableCell strong>
                <div>{row.name}</div>
                <div className="mt-1 text-[11px] font-normal text-[var(--muted)]">
                  {row.ticker ?? "종목 코드 없음"} · {row.market.toUpperCase()} · {row.currency}
                </div>
              </TableCell>
              <TableCell>{accountLabel(row.account)}</TableCell>
              <TableCell>{displayGroupName(row.groupName)}</TableCell>
              <TableCell align="right">{formatNumber(row.quantity, 4)}</TableCell>
              <TableCell align="right">{formatNumber(row.currentPrice, 2)}</TableCell>
              <TableCell align="right">{formatKrw(row.currentValueKrw)}</TableCell>
              <TableCell align="right">{formatPercent(row.currentWeightPct)}</TableCell>
              <TableCell align="right">{formatPercent(row.effectiveTargetPct)}</TableCell>
              <TableCell align="right">{formatSignedPercent(row.driftPct)}</TableCell>
              <TableCell>
                <div>{priceEvidenceLabel(row.priceEvidenceSource)}</div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">{row.priceSource ?? "-"}</div>
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExclusionTable({ rows }: { rows: readonly PortfolioStructureExclusion[] }) {
  return (
    <div className="overflow-x-auto pb-4">
      <table className="w-full min-w-[850px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-[11px] text-[var(--muted)]">
          <tr>
            <TableHeader>종목</TableHeader>
            <TableHeader>계정</TableHeader>
            <TableHeader>그룹</TableHeader>
            <TableHeader>제외 이유</TableHeader>
            <TableHeader align="right">수량</TableHeader>
            <TableHeader align="right">가격</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.reason}-${row.account}-${row.ticker ?? row.name}-${index}`}>
              <TableCell strong>
                <div>{row.name}</div>
                <div className="mt-1 text-[11px] font-normal text-[var(--muted)]">
                  {row.ticker ?? "종목 코드 없음"}
                </div>
              </TableCell>
              <TableCell>{accountLabel(row.account)}</TableCell>
              <TableCell>{displayGroupName(row.groupName)}</TableCell>
              <TableCell>{exclusionReasonLabel(row.reason)}</TableCell>
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
    <div className="varda-hero-metric">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function RailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="varda-rail-metric">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
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

function accountLabel(account: string) {
  if (account === "brokerage") return "증권";
  if (account === "isa") return "ISA";
  if (account === "irp") return "IRP";
  return account;
}

function displayGroupName(name: string) {
  return name === "Ungrouped" ? "미분류" : name;
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
