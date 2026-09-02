import type { ReactNode } from "react";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PresentationDeck } from "@/components/presentation/presentation-deck";
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
        <PresentationDeck
          ariaLabel="포트 구조 프레젠테이션"
          scenes={[
            { id: "overview", label: "구조 요약" },
            { id: "allocation", label: "무게중심" },
            { id: "risk", label: "위험 지형" },
            { id: "holdings", label: "직접 보유" },
            { id: "fx", label: "환율 충격" },
            { id: "coverage", label: "특수 자산" },
            { id: "evidence", label: "원자료" },
          ]}
        >
        <div className="varda-presentation-frame justify-center">
        <section aria-labelledby="portfolio-structure-title">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-[11px] font-medium text-[var(--muted)]">
                  PORTFOLIO / STRUCTURE
                </p>
                <h1 className="varda-page-title" id="portfolio-structure-title">
                  포트 구조
                </h1>
              </div>
              <p className="text-xs text-[var(--muted)]">기준일 {formatDate(data.serviceDate)}</p>
            </div>

            <PortfolioAnalysisScopeTabs
              basePath="/portfolio/structure"
              scopes={data.analysisScopes}
              selectedScopeKey={data.selectedScope.key}
              variant="underline"
            />
          </div>

          <div className="varda-compact-summary">
            <div>
            <p className="text-xs font-medium text-[var(--muted)]">
              {data.selectedScope.label} 현재 평가액
            </p>
            <p className="varda-primary-number mt-2 text-[var(--ink)]">
              {formatKrw(data.structure.totalValueKrw)}
            </p>
            </div>
            <dl className="flex max-w-3xl flex-wrap items-center gap-y-3 text-sm">
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

        <section aria-label="포트 구조 핵심 근거" className="border-b border-[var(--line)]">
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
        </div>

        <div className="varda-presentation-frame justify-center">
          <PortfolioAllocationExplorer
            groupRows={data.structure.groupRows}
            holdingRows={data.structure.holdingRows}
          />
        </div>

        <div className="varda-presentation-frame justify-center">
          <PortfolioStructureRiskAnalytics
            model={data.riskModel}
            scopeKey={data.selectedScope.key}
            totalHoldingCount={data.structure.includedHoldingCount}
          />
        </div>

        <div className="varda-presentation-frame justify-center">
          <DirectHoldingsBaseline
            model={data.directHoldingsBaseline}
            scopeLabel={data.selectedScope.label}
          />
        </div>

        <div className="varda-presentation-frame justify-center">
          <PortfolioFxShock
            baseline={data.directHoldingsBaseline}
            currentUsdKrwRate={data.structure.usdKrwRate}
          />
        </div>

        <div className="varda-presentation-frame justify-center">
          <SpecialHoldingsCoverage model={data.specialHoldingsCoverage} />
        </div>

        <div className="varda-presentation-frame justify-center">
        <section className="border-y border-[var(--line)] py-10">
          <p className="varda-kicker">SOURCE EVIDENCE</p>
          <h2 className="mt-2 text-2xl font-medium">계산에 사용한 원자료</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            긴 표는 현재 장면을 밀어내지 않습니다. 필요한 근거만 선택해 별도 창에서 확인합니다.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <PresentationDialog
              label={`보유 종목 ${data.structure.holdingRows.length}행`}
              title="보유 종목 원자료"
              wide
            >
              <HoldingEvidenceTable rows={data.structure.holdingRows} />
            </PresentationDialog>
            {data.structure.exclusions.length > 0 ? (
              <PresentationDialog
                label={`평가 제외 ${data.structure.exclusions.length}행`}
                title="평가 제외 근거"
                wide
              >
                <ExclusionTable rows={data.structure.exclusions} />
              </PresentationDialog>
            ) : null}
          </div>
        </section>
        <footer className="flex flex-col gap-2 border-t border-[var(--line)] pt-5 text-[11px] text-[var(--faint)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            USD/KRW {formatNumber(data.structure.usdKrwRate, 2)} · 현재 저장·실시간 평가 근거
          </p>
          <p>읽기 전용 · 추천·주문 아님 · 목표비중은 승인 정책만 표시</p>
        </footer>
        </div>
        </PresentationDeck>
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
  divided = false,
  label,
  value,
}: {
  divided?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 ${divided ? "border-l border-[var(--line)]" : ""}`}>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-medium tabular-nums text-[var(--ink)]">{value}</dd>
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
    <div className="min-w-0 border-b border-[var(--wash)] px-5 py-6 last:border-b-0 sm:odd:border-r sm:odd:border-[var(--wash)] lg:border-b-0 lg:border-r lg:border-[var(--wash)] lg:last:border-r-0">
      <p className="text-xs font-medium text-[var(--muted)]">{label}</p>
      <p className="mt-3 truncate text-xl font-medium tabular-nums text-[var(--ink)]" title={value}>
        {value}
      </p>
      <p className="mt-2 truncate text-xs text-[var(--muted)]" title={detail}>
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

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%p`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}
