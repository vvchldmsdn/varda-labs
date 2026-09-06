import Link from "next/link";
import { ChartNoAxesCombined, ListTree, RefreshCw, Target } from "lucide-react";

import {
  AdditionalContributionEvidenceScene,
  AdditionalContributionFlowScene,
  AdditionalContributionWeightScene,
} from "@/components/additional-contribution/additional-contribution-result";
import { PortfolioRefreshButton } from "@/components/home/portfolio-refresh-button";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
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
        <div className="varda-screen">
          <header className="varda-screen-header">
            <div className="varda-screen-heading">
              <div className="varda-screen-title-row">
                <div>
                  <p className="varda-kicker">PORTFOLIO / ADDITIONAL CONTRIBUTION</p>
                  <h1 id="additional-contribution-title" className="varda-page-title">추가 투입</h1>
                </div>
                <p className="text-xs text-[var(--muted)]">실제 주문 전 읽기 전용 미리보기</p>
              </div>
            </div>
            <div className="varda-screen-scope">
              <PortfolioAnalysisScopeTabs
                basePath="/additional-contribution"
                query={{ amount: String(amountKrw) }}
                scopes={scopes}
                selectedScopeKey={selectedScope.key}
                variant="underline"
              />
            </div>
          </header>

          <div className="varda-workspace-grid">
            <div className="varda-main-visual varda-contribution-main">
              {preview.status === "ready" ? (
                <AdditionalContributionFlowScene preview={preview} />
              ) : (
                <BlockedPreview blockers={preview.blockers} />
              )}
            </div>

            <aside className="varda-context-rail" aria-label="추가 투입 계산 제어">
              <section className="varda-rail-section">
                <p className="varda-kicker">CONTRIBUTION AMOUNT</p>
                <h2 className="mt-1 text-sm font-medium">새로 투입할 금액</h2>
                <form action="/additional-contribution" method="get" className="mt-5">
                  <input type="hidden" name="scope" value={selectedScope.key} />
                  <label className="sr-only" htmlFor="additional-contribution-amount">투입 금액</label>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-b border-[var(--line)] pb-2">
                    <input
                      id="additional-contribution-amount"
                      aria-describedby="additional-contribution-amount-hint"
                      className="min-w-0 border-0 bg-transparent py-1 text-right !text-3xl font-normal tabular-nums outline-none placeholder:text-[var(--line)] focus-visible:ring-0"
                      defaultValue={amountKrw ? formatInputKrw(amountKrw) : ""}
                      inputMode="numeric"
                      name="amount"
                      pattern="[0-9,]*"
                      placeholder="0"
                      required
                      type="text"
                    />
                    <span className="pb-1 text-sm text-[var(--muted)]">원</span>
                  </div>
                  <button type="submit" className="varda-action mt-4 w-full">계산하기</button>
                </form>
                <p id="additional-contribution-amount-hint" className="mt-3 text-[10px] text-[var(--faint)]">
                  {formatKrw(amountKrw)} · 만 원 단위 입력 권장
                </p>
                <nav aria-label="투입 금액 빠른 선택" className="mt-4 grid grid-cols-2 gap-2">
                  {AMOUNT_PRESETS.map((preset) => (
                    <Link
                      key={preset}
                      className={`min-h-8 border px-2 py-2 text-center text-[10px] font-medium ${amountKrw === preset ? "border-[var(--brand)] bg-[var(--brand-wash)] text-[var(--ink)]" : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"}`}
                      href={buildPortfolioAnalysisScopeHref("/additional-contribution", selectedScope.key, { amount: String(preset) })}
                    >
                      {formatCompactKrw(preset)}
                    </Link>
                  ))}
                </nav>
              </section>

              {preview.status === "ready" ? (
                <section className="varda-rail-section">
                  <p className="varda-kicker">CALCULATION VIEWS</p>
                  <h2 className="mt-1 text-sm font-medium">배분안을 더 자세히 보기</h2>
                  <div className="mt-4 grid gap-2">
                    <PresentationDialog label="비중 변화" title="투입 전후 비중 변화" wide>
                      <AdditionalContributionWeightScene preview={preview} />
                    </PresentationDialog>
                    <PresentationDialog label="계산 근거" title="추가 투입 계산 근거" wide>
                      <AdditionalContributionEvidenceScene preview={preview} />
                    </PresentationDialog>
                  </div>
                </section>
              ) : null}
            </aside>
          </div>

          <footer className="varda-screen-footer">
            <div className="varda-inline-actions" aria-label="빠른 작업">
              {enableLivePriceSync ? (
                <PortfolioRefreshButton autoSync />
              ) : (
                <span className="varda-inline-action"><RefreshCw aria-hidden="true" size={15} />디자인 샘플 데이터</span>
              )}
              <Link className="varda-inline-action" href={buildPortfolioAnalysisScopeHref("/portfolio/targets", selectedScope.key)}>
                <Target aria-hidden="true" size={15} />목표비중 확인
              </Link>
              <Link className="varda-inline-action" href={buildPortfolioAnalysisScopeHref("/portfolio/holdings", selectedScope.key)}>
                <ListTree aria-hidden="true" size={15} />보유 종목 관리
              </Link>
            </div>
            <span className="inline-flex items-center gap-2"><ChartNoAxesCombined aria-hidden="true" size={13} />계산 결과는 저장·주문하지 않음</span>
          </footer>
        </div>
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
