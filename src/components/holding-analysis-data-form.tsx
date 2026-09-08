"use client";

import { ManagementText } from "@/components/i18n/management-text";
import { useActionState } from "react";

import { prepareHoldingAnalysisData } from "@/app/portfolio/holdings/actions";
import type {
  HoldingAnalysisDataPreparationActionState,
  HoldingAnalysisDataReadiness,
} from "@/lib/holding-analysis-data-readiness";

const INITIAL_STATE: HoldingAnalysisDataPreparationActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function HoldingAnalysisDataForm({
  holdingId,
  readiness,
}: {
  holdingId: string;
  readiness: HoldingAnalysisDataReadiness | null;
}) {
  const [state, action, pending] = useActionState(
    prepareHoldingAnalysisData,
    INITIAL_STATE,
  );
  const messageId = `holding-analysis-data-${holdingId}`;

  if (!readiness) {
    return <p className="text-xs text-[var(--warning)]"><ManagementText>{"상태 확인 불가"}</ManagementText></p>;
  }

  return (
    <div className="min-w-[190px] text-xs text-[var(--muted)]">
      <p className="font-semibold text-[var(--ink)]">
        {readinessLabel(readiness)}
      </p>
      {readiness.state !== "unsupported" && readiness.state !== "blocked" ? (
        <>
          <p className="mt-1 tabular-nums"><ManagementText>{"가격"}</ManagementText>{readiness.observationCount}<ManagementText>{"일"}</ManagementText><ManagementText>{readiness.latestSourceDate
              ? ` · 최신 ${readiness.latestSourceDate}`
              : ""}</ManagementText>
          </p>
          <p className="mt-1"><ManagementText>{"시뮬레이션"}</ManagementText><ManagementText>{readiness.simulationReady ? "가능" : "준비 중"}</ManagementText><ManagementText>{"· 추세"}</ManagementText>{" "}
            <ManagementText>{readiness.trendReady ? "가능" : "준비 중"}</ManagementText>
          </p>
        </>
      ) : null}
      {readiness.canPrepare ? (
        <form action={action} className="mt-2">
          <input name="holdingId" type="hidden" value={holdingId} />
          <button
            aria-describedby={messageId}
            className="rounded-md border border-[var(--faint)] bg-white px-2.5 py-1.5 font-semibold text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            <ManagementText>{pending ? "가격 확인 중" : "과거 가격 준비"}</ManagementText>
          </button>
        </form>
      ) : null}
      <p
        aria-live="polite"
        className={[
          "mt-1 min-h-4 leading-5",
          state.status === "success" || state.status === "already_ready"
            ? "text-[var(--brand)]"
            : "text-[var(--warning)]",
        ].join(" ")}
        id={messageId}
      >
        <ManagementText>{state.message}</ManagementText>
      </p>
    </div>
  );
}

function readinessLabel(readiness: HoldingAnalysisDataReadiness) {
  if (readiness.state === "ready") return "분석 준비 완료";
  if (readiness.state === "missing") return "과거 가격 없음";
  if (readiness.state === "limited") {
    return readiness.reason === "latest_close_stale"
      ? "최신 가격 보완 필요"
      : "일부 분석 가능";
  }
  if (readiness.reason === "manual_history_required") {
    return "수동 평가 기록 사용";
  }
  if (readiness.reason === "managed_sleeve_excluded") {
    return "투자랩·시뮬레이션 제외";
  }
  if (readiness.state === "blocked") return "분석 범위 확인 필요";
  return "자동 가격 준비 미지원";
}
