import { ManagementText } from "@/components/i18n/management-text";
import { HoldingAnalysisDataForm } from "@/components/holding-analysis-data-form";
import type { ScopedHoldingAnalysisDataReadinessQueryResult } from "@/db/queries/holding-analysis-data-readiness";
import { SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";
import { T } from "@/components/i18n/localized-text";


export async function HoldingAnalysisDataPanel({
  resultPromise,
  showReadyState = false,
}: {
  resultPromise: Promise<ScopedHoldingAnalysisDataReadinessQueryResult>;
  showReadyState?: boolean;
}) {
  let result: ScopedHoldingAnalysisDataReadinessQueryResult;
  try {
    result = await resultPromise;
  } catch {
    result = Object.freeze({ state: "unavailable" as const });
  }

  return <HoldingAnalysisDataPanelView result={result} showReadyState={showReadyState} />;
}

export function HoldingAnalysisDataPanelView({ result, showReadyState = false }: { result: ScopedHoldingAnalysisDataReadinessQueryResult; showReadyState?: boolean }) {
  if (result.state !== "ready") {
    return (
      <section
        className="border-y border-[var(--warning-soft)] py-4 text-sm text-[var(--warning)]"
        data-section="holding-analysis-data-repair"
        data-status="unavailable"
      ><ManagementText>{"과거 가격 준비 상태를 읽지 못했습니다. 기존 계산 결과는 변경하지 않았습니다."}</ManagementText></section>
    );
  }

  const actionable = result.entries.filter((entry) => entry.readiness.state !== "ready");
  if (actionable.length === 0) return showReadyState ? <p role="status"><T ko={result.entries.length ? "확인한 보유 종목의 과거 가격이 준비되어 있어요. 각 비교의 계산 가능 여부는 해당 결과에서 확인할 수 있어요." : "이 범위에서 과거 가격 준비 상태를 확인할 보유 종목이 없어요."} en={result.entries.length ? "Historical prices are ready for the checked holdings. Each comparison shows whether its own calculation requirements are met." : "There are no holdings to check for historical-price readiness in this scope."} /></p> : null;

  return (
    <section
      className="border-y border-[var(--line)] py-5"
      data-actionable-count={actionable.length}
      data-section="holding-analysis-data-repair"
      data-status="actionable"
    >
      <CairnSectionTitle className="text-base font-semibold"><ManagementText>{"부족한 과거 가격 준비"}</ManagementText></CairnSectionTitle>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]"><ManagementText>{"현재 구성은 바로 볼 수 있어요. 과거 분석에 부족한 자료를 확인해 주세요."}</ManagementText></p>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {actionable.map((entry) => (
          <div
            className="border-b border-[var(--line)] py-4"
            key={entry.holdingId}
          >
            <p className="text-sm font-semibold">{entry.name}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              <ManagementText>{entry.ticker ?? "티커 없음"}</ManagementText> · {entry.accountCode}
            </p>
            <div className="mt-2">
              <HoldingAnalysisDataForm
                holdingId={entry.holdingId}
                readiness={entry.readiness}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HoldingAnalysisDataPanelSkeleton() {
  return (
    <section className="h-28 animate-pulse border-y border-[var(--line)] bg-[var(--wash)]" />
  );
}
