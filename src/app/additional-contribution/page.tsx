import Link from "next/link";

import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { getReadOnlyTenantAdditionalContributionPreviewForScope } from "@/db/queries/additional-contribution";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { buildPortfolioAnalysisScopeHref } from "@/lib/portfolio-analysis-scope";

export const dynamic = "force-dynamic";

const DEFAULT_AMOUNT_KRW = 3_000_000;
const MAX_AMOUNT_KRW = 100_000_000_000;

type AdditionalContributionPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    amount?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function AdditionalContributionPage({
  searchParams,
}: AdditionalContributionPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const amountKrw = normalizeAmount(params.amount);

  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        closedMessage="로그인과 계정 소유권이 확인되기 전에는 추가 투입 계산 데이터를 읽지 않습니다."
        description="승인된 목표비중과 현재 평가액을 로그인한 사용자의 계정 범위에서만 읽습니다."
        resolution={resolution}
        title="추가 투입"
      />
    );
  }

  const scopeContext = await getReadOnlyTenantPortfolioAnalysisScopeContext({
    account: params.account,
    scope: params.scope,
    tenantContext: resolution.tenantContext,
  });
  if (
    scopeContext.state !== "ready" ||
    scopeContext.resolution.state !== "resolved"
  ) {
    return (
      <PortfolioAnalysisScopeBoundary
        basePath="/additional-contribution"
        context={scopeContext}
        title="추가 투입"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  const preview = await getReadOnlyTenantAdditionalContributionPreviewForScope({
    cashAmountKrw: amountKrw,
    scope: selectedScope,
    tenantContext: resolution.tenantContext,
  });

  return (
    <main
      className="min-h-screen bg-[#f3f4ef] px-4 py-4 text-[#171916]"
      data-page="additional-contribution"
      data-preview-status={preview.status}
    >
      <div className="mx-auto w-full max-w-[1400px] space-y-4">
        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                추가 투입
              </h1>
              <p className="mt-2 text-sm text-[#687064]">
                승인된 목표비중과 현재 평가액을 기준으로 새 현금의 분배안을 계산합니다.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">홈</NavLink>
              <NavLink href="/today">오늘 변동</NavLink>
              <NavLink href="/portfolio/structure">포트 구조</NavLink>
              <NavLink
                href={buildPortfolioAnalysisScopeHref(
                  "/portfolio/targets",
                  selectedScope.key,
                )}
              >
                목표비중
              </NavLink>
              <NavLink href="/history">히스토리</NavLink>
            </nav>
          </div>

          <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <PortfolioAnalysisScopeTabs
              basePath="/additional-contribution"
              query={{ amount: String(amountKrw || DEFAULT_AMOUNT_KRW) }}
              scopes={scopeContext.catalog.scopes}
              selectedScopeKey={selectedScope.key}
            />

            <form
              action="/additional-contribution"
              method="get"
              className="flex w-full max-w-xl flex-col gap-2 sm:flex-row sm:items-end"
            >
              <input type="hidden" name="scope" value={selectedScope.key} />
              <label className="min-w-0 flex-1 text-sm font-semibold">
                투입 금액
                <span className="mt-1 flex items-center rounded-md border border-[#cfd6c8] bg-white px-3">
                  <input
                    className="min-w-0 flex-1 bg-transparent py-2 text-right text-base font-semibold outline-none"
                    defaultValue={amountKrw}
                    inputMode="numeric"
                    max={MAX_AMOUNT_KRW}
                    min={1}
                    name="amount"
                    required
                    step={10_000}
                    type="number"
                  />
                  <span className="ml-2 text-[#687064]">원</span>
                </span>
              </label>
              <button
                type="submit"
                className="rounded-md bg-[#1e3a34] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#294d45]"
              >
                계산
              </button>
            </form>
          </div>
        </section>

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">분배 미리보기</h2>
              <p className="mt-1 text-sm text-[#687064]">
                읽기 전용 계산입니다. 주문, 저장, 매도는 수행하지 않습니다.
              </p>
            </div>
            <span className="rounded-md border border-[#d8dfd0] bg-white px-3 py-2 text-sm font-semibold text-[#445248]">
              {selectedScope.label} · {formatKrw(amountKrw)}
            </span>
          </div>

          {preview.status === "ready" ? (
            <ReadyPreview preview={preview} />
          ) : (
            <BlockedPreview blockers={preview.blockers} />
          )}
        </section>
      </div>
    </main>
  );
}

function ReadyPreview({
  preview,
}: {
  preview: Extract<
    Awaited<
      ReturnType<
        typeof getReadOnlyTenantAdditionalContributionPreviewForScope
      >
    >,
    { status: "ready" }
  >;
}) {
  return (
    <>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCell
          label="현재 평가액"
          value={formatKrw(preview.currentPortfolioTotalKrw)}
        />
        <SummaryCell
          label="배분 금액"
          value={formatKrw(preview.totalAllocatedKrw)}
        />
        <SummaryCell
          label="남는 현금"
          value={formatKrw(preview.residualCashKrw)}
        />
        <SummaryCell
          label="적용 정책"
          value={preview.policyLabel}
          detail={`${preview.effectiveServiceDate}부터 · 기준일 ${preview.serviceDate}`}
        />
        <SummaryCell
          label="MA120 근거"
          value={`${preview.ma120Evidence.usableCount}/${preview.rows.length} 종목`}
          detail={ma120SummaryDetail(preview.ma120Evidence.status)}
        />
      </dl>

      <div className="mt-5 overflow-x-auto rounded-md border border-[#dfe3d5] bg-white">
        <table className="w-full min-w-[1160px] border-collapse text-sm">
          <thead className="bg-[#edf1e8] text-left text-xs text-[#596257]">
            <tr>
              <th className="px-3 py-3">종목</th>
              <th className="px-3 py-3">계좌</th>
              <th className="px-3 py-3">시장</th>
              <th className="px-3 py-3 text-right">현재 평가액</th>
              <th className="px-3 py-3 text-right">현재 비중</th>
              <th className="px-3 py-3 text-right">목표 비중</th>
              <th className="px-3 py-3 text-right">MA120 참고</th>
              <th className="px-3 py-3 text-right">투입 금액</th>
              <th className="px-3 py-3 text-right">투입 후 비중</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr
                key={`${row.accountCode}:${row.market}:${row.currency}:${row.ticker ?? row.name}`}
                className="border-t border-[#e4e8de]"
              >
                <td className="px-3 py-3">
                  <p className="font-semibold">{row.ticker}</p>
                  <p className="mt-0.5 text-xs text-[#687064]">{row.name}</p>
                </td>
                <td className="px-3 py-3 text-[#596257]">
                  {row.accountName}
                </td>
                <td className="px-3 py-3 text-[#596257]">
                  {row.market} · {row.currency}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatKrw(row.currentValueKrw)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatPercent(row.currentWeightPct)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatPercent(row.targetWeightPct)}
                </td>
                <td className="px-3 py-3 text-right">
                  <Ma120EvidenceCell
                    currency={row.currency}
                    evidence={row.ma120Evidence}
                  />
                </td>
                <td className="px-3 py-3 text-right font-semibold text-[#1e5d49]">
                  {formatKrw(row.allocationKrw)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatPercent(row.postTopupWeightPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Ma120EvidenceCell({
  currency,
  evidence,
}: {
  currency: string | null;
  evidence: {
    status:
      | "above_ma"
      | "at_ma"
      | "below_ma"
      | "insufficient_history"
      | "invalid_history"
      | "unavailable";
    priceBasis: "provider_adjusted_close" | "private_kis_raw_close" | null;
    availableObservationCount: number;
    latestWindowPriceDate: string | null;
    ma120: number | null;
    distanceFromMaPct: number | null;
  };
}) {
  if (evidence.status === "insufficient_history") {
    return (
      <span data-ma120-status={evidence.status} className="text-[#76591f]">
        이력 부족 {evidence.availableObservationCount}/120
      </span>
    );
  }
  if (
    evidence.status === "unavailable" ||
    evidence.status === "invalid_history" ||
    evidence.ma120 === null ||
    evidence.distanceFromMaPct === null
  ) {
    return (
      <span data-ma120-status={evidence.status} className="text-[#7a8178]">
        근거 없음
      </span>
    );
  }

  const tone =
    evidence.status === "below_ma"
      ? "text-[#b83c3c]"
      : evidence.status === "above_ma"
        ? "text-[#1e6a4a]"
        : "text-[#4f5850]";
  return (
    <div data-ma120-status={evidence.status}>
      <p className={`font-semibold ${tone}`}>
        {evidence.status === "above_ma"
          ? "위"
          : evidence.status === "below_ma"
            ? "아래"
            : "근접"}{" "}
        {formatSignedPercent(evidence.distanceFromMaPct)}
      </p>
      <p className="mt-0.5 text-xs text-[#687064]">
        MA120 {formatPrice(evidence.ma120, currency)} ·{" "}
        {evidence.priceBasis === "provider_adjusted_close"
          ? "조정 종가"
          : "KIS 원종가"}
        {evidence.latestWindowPriceDate
          ? ` · ${evidence.latestWindowPriceDate}`
          : ""}
      </p>
    </div>
  );
}

function BlockedPreview({
  blockers,
}: {
  blockers: readonly string[];
}) {
  return (
    <div className="mt-5 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-4 text-sm text-[#76591f]">
      <p className="font-semibold">지금은 계산할 수 없습니다.</p>
      <ul className="mt-2 space-y-1">
        {blockers.map((blocker) => (
          <li key={blocker}>· {blockerLabel(blocker)}</li>
        ))}
      </ul>
    </div>
  );
}

function SummaryCell({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-[#dfe3d5] bg-white p-4">
      <dt className="text-xs font-semibold text-[#687064]">{label}</dt>
      <dd className="mt-2 text-lg font-semibold">{value}</dd>
      {detail ? <p className="mt-1 text-xs text-[#687064]">{detail}</p> : null}
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#cfd6c8] bg-white px-3 py-2 text-[#35423a] hover:bg-[#eef2e8]"
    >
      {children}
    </Link>
  );
}

function normalizeAmount(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === "") return DEFAULT_AMOUNT_KRW;
  const amount = Number(raw);
  return Number.isSafeInteger(amount) &&
    amount > 0 &&
    amount <= MAX_AMOUNT_KRW
    ? amount
    : 0;
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
    unallocatable_target_deficit: "부족 비중을 매수 가능한 종목에 배분할 수 없습니다.",
  };
  return labels[blocker] ?? `데이터 검증 실패: ${blocker}`;
}

function formatKrw(value: number) {
  return `₩${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatSignedPercent(value: number) {
  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
    signDisplay: "always",
  }).format(value);
  return `${formatted}%`;
}

function formatPrice(value: number, currency: string | null) {
  return new Intl.NumberFormat(currency === "KRW" ? "ko-KR" : "en-US", {
    maximumFractionDigits: currency === "KRW" ? 0 : 4,
  }).format(value);
}

function ma120SummaryDetail(
  status: "ready" | "partial" | "unavailable" | "read_failed",
) {
  if (status === "read_failed") return "근거 조회 실패 · 분배액은 정상 표시";
  if (status === "unavailable") return "사용 가능한 가격 이력 없음 · 분배 미반영";
  if (status === "partial") return "일부 종목만 계산 · 분배 미반영";
  return "최근 120개 관측치 · 분배 미반영";
}
