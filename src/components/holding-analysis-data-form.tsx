"use client";

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
    return <p className="text-xs text-[#8a5b16]">상태 확인 불가</p>;
  }

  return (
    <div className="min-w-[190px] text-xs text-[#5e685e]">
      <p className="font-semibold text-[#35423a]">
        {readinessLabel(readiness)}
      </p>
      {readiness.state !== "unsupported" && readiness.state !== "blocked" ? (
        <>
          <p className="mt-1 tabular-nums">
            가격 {readiness.observationCount}일
            {readiness.latestSourceDate
              ? ` · 최신 ${readiness.latestSourceDate}`
              : ""}
          </p>
          <p className="mt-1">
            시뮬레이션 {readiness.simulationReady ? "가능" : "준비 중"} · 추세{" "}
            {readiness.trendReady ? "가능" : "준비 중"}
          </p>
        </>
      ) : null}
      {readiness.canPrepare ? (
        <form action={action} className="mt-2">
          <input name="holdingId" type="hidden" value={holdingId} />
          <button
            aria-describedby={messageId}
            className="rounded-md border border-[#9caf9f] bg-white px-2.5 py-1.5 font-semibold text-[#1e3a34] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "가격 확인 중" : "과거 가격 준비"}
          </button>
        </form>
      ) : null}
      <p
        aria-live="polite"
        className={[
          "mt-1 min-h-4 leading-5",
          state.status === "success" || state.status === "already_ready"
            ? "text-[#1e5d49]"
            : "text-[#8a5b16]",
        ].join(" ")}
        id={messageId}
      >
        {state.message}
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
