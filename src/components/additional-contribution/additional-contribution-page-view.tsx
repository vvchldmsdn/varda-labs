import Link from "next/link";

import {
  AdditionalContributionEvidenceScene,
  AdditionalContributionFlowScene,
  AdditionalContributionWeightScene,
} from "@/components/additional-contribution/additional-contribution-result";
import { PortfolioRefreshButton } from "@/components/home/portfolio-refresh-button";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PresentationDeck } from "@/components/presentation/presentation-deck";
import type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScope,
} from "@/lib/portfolio-analysis-scope";

const AMOUNT_PRESETS = [1_000_000, 3_000_000, 5_000_000, 10_000_000] as const;

type BlockedPreview = Readonly<{
  status: "blocked";
  blockers: readonly string[];
}>;

export function AdditionalContributionPageView({
  amountKrw,
  enableLivePriceSync = true,
  generatedAt,
  preview,
  scopes,
  selectedScope,
}: {
  amountKrw: number;
  enableLivePriceSync?: boolean;
  generatedAt: string;
  preview: AdditionalContributionResultPreview | BlockedPreview;
  scopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  const scenes = [
    { id: "amount", label: "투입 금액" },
    ...(preview.status === "ready"
      ? [
          { id: "flow", label: "자금 흐름" },
          { id: "weights", label: "비중 변화" },
          { id: "evidence", label: "계산 근거" },
        ]
      : [{ id: "readiness", label: "계산 준비" }]),
    { id: "actions", label: "다음 작업" },
  ];

  return (
    <main
      className="varda-page varda-presentation-page bg-[var(--paper)] text-[var(--ink)]"
      data-page="additional-contribution"
      data-preview-status={preview.status}
    >
      <PortfolioPrimaryNavigation
        activePath="/additional-contribution"
        generatedAt={generatedAt}
        selectedScopeKey={selectedScope.key}
      />

      <div className="varda-content varda-presentation-content">
        <PresentationDeck ariaLabel="추가 투입 프레젠테이션" scenes={scenes}>
        <div className="varda-presentation-frame justify-center">
        <section aria-labelledby="additional-contribution-title">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-[11px] font-medium text-[var(--muted)]">
                  PORTFOLIO / ADDITIONAL CONTRIBUTION
                </p>
                <h1 id="additional-contribution-title" className="varda-page-title">
                  추가 투입
                </h1>
              </div>
              <p className="text-xs text-[var(--muted)]">
                실제 주문 전 읽기 전용 미리보기
              </p>
            </div>

            <PortfolioAnalysisScopeTabs
              basePath="/additional-contribution"
              query={{ amount: String(amountKrw) }}
              scopes={scopes}
              selectedScopeKey={selectedScope.key}
              variant="underline"
            />
          </div>

          <div className="varda-summary-stage varda-contribution-controls">
            <p className="text-xs font-medium text-[var(--muted)]">
              {selectedScope.label}에 새로 투입할 금액
            </p>
            <form
              action="/additional-contribution"
              method="get"
              className="mx-auto mt-3 grid w-full max-w-[760px] grid-cols-[minmax(0,1fr)_auto] items-center justify-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-0"
            >
              <input type="hidden" name="scope" value={selectedScope.key} />
              <label className="sr-only" htmlFor="additional-contribution-amount">
                투입 금액
              </label>
              <input
                id="additional-contribution-amount"
                aria-describedby="additional-contribution-amount-hint"
                className="min-w-0 border-0 bg-transparent py-2 text-right !text-4xl font-normal tabular-nums outline-none placeholder:text-[var(--line)] focus-visible:ring-0 min-[420px]:!text-5xl sm:!text-6xl lg:!text-[80px]"
                defaultValue={amountKrw ? formatInputKrw(amountKrw) : ""}
                inputMode="numeric"
                name="amount"
                pattern="[0-9,]*"
                placeholder="0"
                required
                type="text"
              />
              <span className="shrink-0 text-2xl font-normal text-[var(--muted)] min-[420px]:text-3xl sm:ml-3 sm:text-4xl lg:text-5xl">
                원
              </span>
              <button
                type="submit"
                className="col-span-2 mx-auto mt-3 shrink-0 border-b border-[var(--ink)] px-1 py-2 text-sm font-medium hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] sm:col-span-1 sm:ml-8 sm:mt-0"
              >
                계산
              </button>
            </form>
            <p
              id="additional-contribution-amount-hint"
              className="mt-3 text-xs text-[var(--faint)]"
            >
              {formatKrw(amountKrw)} · 만 원 단위 입력 권장
            </p>
            <nav
              aria-label="투입 금액 빠른 선택"
              className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm"
            >
              {AMOUNT_PRESETS.map((preset) => (
                <Link
                  key={preset}
                  className={`border-b py-1 font-medium focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--brand)] ${
                    amountKrw === preset
                      ? "border-[var(--ink)] text-[var(--ink)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                  href={buildPortfolioAnalysisScopeHref(
                    "/additional-contribution",
                    selectedScope.key,
                    { amount: String(preset) },
                  )}
                >
                  {formatCompactKrw(preset)}
                </Link>
              ))}
            </nav>
          </div>
        </section>
        </div>

        {preview.status === "ready" ? (
          <AdditionalContributionFlowScene preview={preview} />
        ) : (
          <div className="varda-presentation-frame justify-center">
            <BlockedPreview blockers={preview.blockers} />
          </div>
        )}
        {preview.status === "ready" ? (
          <AdditionalContributionWeightScene preview={preview} />
        ) : null}
        {preview.status === "ready" ? (
          <AdditionalContributionEvidenceScene preview={preview} />
        ) : null}

        <div className="varda-presentation-frame justify-center">
        <section
          aria-label="빠른 작업"
          className="grid gap-6 border-y border-[var(--line)] py-10 sm:grid-cols-3 sm:gap-0"
        >
          <div className="flex justify-center sm:border-r sm:border-[var(--line)]">
            {enableLivePriceSync ? (
              <PortfolioRefreshButton autoSync />
            ) : (
              <span className="inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium text-[var(--muted)]">
                <span aria-hidden="true" className="text-xl">◎</span>
                디자인 샘플 데이터
              </span>
            )}
          </div>
          <div className="flex justify-center sm:border-r sm:border-[var(--line)]">
            <Link
              className="inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
              href={buildPortfolioAnalysisScopeHref(
                "/portfolio/targets",
                selectedScope.key,
              )}
            >
              <span aria-hidden="true" className="text-xl">◎</span>
              목표비중 확인
            </Link>
          </div>
          <div className="flex justify-center">
            <Link
              className="inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
              href={buildPortfolioAnalysisScopeHref(
                "/portfolio/holdings",
                selectedScope.key,
              )}
            >
              <span aria-hidden="true" className="text-xl">＋</span>
              보유 종목 관리
            </Link>
          </div>
        </section>
        </div>
        </PresentationDeck>
      </div>
    </main>
  );
}

function BlockedPreview({ blockers }: { blockers: readonly string[] }) {
  return (
    <section
      className="border-y border-[var(--line)] py-12"
      aria-labelledby="blocked-title"
    >
      <p className="text-[11px] font-medium text-[var(--muted)]">CALCULATION STATUS</p>
      <h2 id="blocked-title" className="mt-2 text-2xl font-medium">
        지금은 배분안을 계산할 수 없습니다
      </h2>
      <ul className="mt-6 max-w-3xl divide-y divide-[var(--wash)] border-y border-[var(--line)] text-sm text-[var(--warning)]">
        {blockers.map((blocker) => (
          <li key={blocker} className="py-4">
            {blockerLabel(blocker)}
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

function formatCompactKrw(value: number) {
  if (value >= 100_000_000) return `${value / 100_000_000}억원`;
  if (value >= 10_000) return `${value / 10_000}만원`;
  return `${value}원`;
}

function formatInputKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value);
}
