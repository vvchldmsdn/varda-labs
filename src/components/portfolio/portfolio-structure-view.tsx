import type { ReactNode } from "react";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
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

  return (
    <main
      className="min-h-screen overflow-x-hidden bg-[#f7f8f5] text-[#20231f]"
      data-page="portfolio-structure"
    >
      <PortfolioPrimaryNavigation
        activePath="/portfolio/structure"
        generatedAt={data.generatedAt}
        selectedScopeKey={data.selectedScope.key}
      />

      <div className="mx-auto w-full max-w-[1540px] px-5 pb-12 pt-8 sm:px-8 lg:px-10 lg:pb-16 lg:pt-10">
        <section aria-labelledby="portfolio-structure-title">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-[11px] font-medium text-[#7b8079]">
                  PORTFOLIO / STRUCTURE
                </p>
                <h1 className="sr-only" id="portfolio-structure-title">
                  포트 구조
                </h1>
              </div>
              <p className="text-xs text-[#7b8079]">기준일 {formatDate(data.serviceDate)}</p>
            </div>

            <PortfolioAnalysisScopeTabs
              basePath="/portfolio/structure"
              scopes={data.analysisScopes}
              selectedScopeKey={data.selectedScope.key}
              variant="underline"
            />
          </div>

          <div className="pb-11 pt-12 text-center sm:pb-14 sm:pt-14 lg:pb-16 lg:pt-16">
            <p className="text-xs font-medium text-[#737970]">
              {data.selectedScope.label} 현재 평가액
            </p>
            <p className="mt-3 text-5xl font-normal tabular-nums text-[#151714] sm:text-6xl lg:text-[80px]">
              {formatKrw(data.structure.totalValueKrw)}
            </p>
            <dl className="mx-auto mt-7 flex max-w-3xl flex-wrap items-center justify-center gap-y-3 text-sm">
              <HeroMetric
                label="보유 종목"
                value={`${data.structure.includedHoldingCount}개`}
              />
              <HeroMetric
                divided
                label="보유 집중 ENB"
                value={
                  data.directHoldingsBaseline.metrics
                    ? formatNumber(
                        data.directHoldingsBaseline.metrics.effectiveHoldingCount,
                        2,
                      )
                    : "-"
                }
              />
              <HeroMetric divided label="목표 정책" value={policyStatus} />
            </dl>
          </div>
        </section>

        <PortfolioAllocationExplorer
          groupRows={data.structure.groupRows}
          holdingRows={data.structure.holdingRows}
        />

        <section aria-label="포트 구조 핵심 근거" className="border-b border-[#d9ddd7]">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4">
            <EvidenceMetric
              detail="현재 평가 가능한 직접 보유 기준"
              label="집중도 HHI"
              value={
                data.directHoldingsBaseline.metrics
                  ? formatNumber(data.directHoldingsBaseline.metrics.hhiPoints, 0)
                  : "계산 대기"
              }
            />
            <EvidenceMetric
              detail="직접 보유 상위 3개 비중 합계"
              label="상위 3개 집중"
              value={
                data.directHoldingsBaseline.metrics
                  ? formatPercent(data.directHoldingsBaseline.metrics.topThreeWeightPct)
                  : "계산 대기"
              }
            />
            <EvidenceMetric
              detail={policyDetail}
              label="목표 연결"
              value={
                data.targetProjection.coverage.policyTargetCount > 0
                  ? `${data.targetProjection.coverage.matchedHoldingCount}/${data.targetProjection.coverage.policyTargetCount}`
                  : "미설정"
              }
            />
            <EvidenceMetric
              detail={dataHealthDetail(data.structure)}
              label="평가 근거"
              value={`${data.structure.includedHoldingCount}/${data.structure.dataHealth.selectedAssetCount}`}
            />
          </div>
        </section>

        <div className="mt-12 lg:mt-16">
          <PortfolioStructureRiskAnalytics
            model={data.riskModel}
            scopeKey={data.selectedScope.key}
            totalHoldingCount={data.structure.includedHoldingCount}
          />
        </div>

        <div className="mt-12 space-y-12 lg:mt-16 lg:space-y-16">
          <DirectHoldingsBaseline
            model={data.directHoldingsBaseline}
            scopeLabel={data.selectedScope.label}
          />

          <PortfolioFxShock
            baseline={data.directHoldingsBaseline}
            currentUsdKrwRate={data.structure.usdKrwRate}
          />

          <SpecialHoldingsCoverage model={data.specialHoldingsCoverage} />
        </div>

        <section className="mt-12 border-t border-[#d9ddd7] pt-8 lg:mt-16 lg:pt-10">
          <details className="group">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]">
              <span>보유 종목 원자료</span>
              <span className="text-xs font-normal text-[#737970] group-open:hidden">
                {data.structure.holdingRows.length}행 보기 ＋
              </span>
              <span className="hidden text-xs font-normal text-[#737970] group-open:inline">
                접기 －
              </span>
            </summary>
            <HoldingEvidenceTable rows={data.structure.holdingRows} />
          </details>

          {data.structure.exclusions.length > 0 ? (
            <details className="group border-t border-[#e1e4df]">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]">
                <span>평가 제외 근거</span>
                <span className="text-xs font-normal text-[#737970] group-open:hidden">
                  {data.structure.exclusions.length}행 보기 ＋
                </span>
                <span className="hidden text-xs font-normal text-[#737970] group-open:inline">
                  접기 －
                </span>
              </summary>
              <ExclusionTable rows={data.structure.exclusions} />
            </details>
          ) : null}
        </section>

        <footer className="flex flex-col gap-2 border-t border-[#d9ddd7] pt-5 text-[11px] text-[#858a83] sm:flex-row sm:items-center sm:justify-between">
          <p>
            USD/KRW {formatNumber(data.structure.usdKrwRate, 2)} · 현재 저장·실시간 평가 근거
          </p>
          <p>읽기 전용 · 추천·주문 아님 · 목표비중은 승인 정책만 표시</p>
        </footer>
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
        <thead className="text-[11px] text-[#6d736b]">
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
                <div className="mt-1 text-[11px] font-normal text-[#767c74]">
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
                <div className="mt-1 text-[11px] text-[#767c74]">{row.priceSource ?? "-"}</div>
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
        <thead className="text-[11px] text-[#6d736b]">
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
                <div className="mt-1 text-[11px] font-normal text-[#767c74]">
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
  divided = false,
  label,
  value,
}: {
  divided?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 ${divided ? "border-l border-[#d3d7d1]" : ""}`}>
      <dt className="text-[#666c64]">{label}</dt>
      <dd className="font-medium tabular-nums text-[#20231f]">{value}</dd>
    </div>
  );
}

function EvidenceMetric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-b border-[#e2e5df] px-5 py-6 last:border-b-0 sm:odd:border-r sm:odd:border-[#e2e5df] lg:border-b-0 lg:border-r lg:border-[#e2e5df] lg:last:border-r-0">
      <p className="text-xs font-medium text-[#6d736b]">{label}</p>
      <p className="mt-3 truncate text-xl font-medium tabular-nums text-[#20231f]" title={value}>
        {value}
      </p>
      <p className="mt-2 truncate text-xs text-[#747a72]" title={detail}>
        {detail}
      </p>
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
      className={`border-b border-[#d9ddd7] px-3 py-3 font-medium ${
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
      className={`border-b border-[#e8ebe6] px-3 py-3 align-top ${
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

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%p`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}
