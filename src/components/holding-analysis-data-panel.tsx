import { HoldingAnalysisDataForm } from "@/components/holding-analysis-data-form";
import type { ScopedHoldingAnalysisDataReadinessQueryResult } from "@/db/queries/holding-analysis-data-readiness";

export async function HoldingAnalysisDataPanel({
  resultPromise,
}: {
  resultPromise: Promise<ScopedHoldingAnalysisDataReadinessQueryResult>;
}) {
  let result: ScopedHoldingAnalysisDataReadinessQueryResult;
  try {
    result = await resultPromise;
  } catch {
    result = Object.freeze({ state: "unavailable" as const });
  }

  if (result.state !== "ready") {
    return (
      <section
        className="border-y border-[var(--warning-soft)] py-4 text-sm text-[var(--warning)]"
        data-section="holding-analysis-data-repair"
        data-status="unavailable"
      >
        과거 가격 준비 상태를 읽지 못했습니다. 기존 계산 결과는 변경하지 않았습니다.
      </section>
    );
  }

  const actionable = result.entries.filter((entry) => entry.readiness.canPrepare);
  if (actionable.length === 0) return null;

  return (
    <section
      className="border-y border-[var(--line)] py-5"
      data-actionable-count={actionable.length}
      data-section="holding-analysis-data-repair"
      data-status="actionable"
    >
      <h2 className="text-base font-semibold">부족한 과거 가격 준비</h2>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
        결과 전체를 숨기지 않고 준비된 범위는 그대로 보여줍니다. 아래 버튼은 선택한
        종목만 KIS에서 조회하며, 임의 평균값으로 과거 가격을 만들지 않습니다.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {actionable.map((entry) => (
          <div
            className="rounded-[4px] border border-[var(--line)] bg-white px-3 py-3"
            key={entry.holdingId}
          >
            <p className="text-sm font-semibold">{entry.name}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {entry.ticker ?? "티커 없음"} · {entry.accountCode}
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
