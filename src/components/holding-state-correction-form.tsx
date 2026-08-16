"use client";

import { useActionState } from "react";

import { correctHoldingState } from "@/app/portfolio/holdings/actions";
import {
  HOLDING_STATE_CORRECTION_POLICY,
  type HoldingStateCorrectionActionState,
} from "@/lib/holding-state-correction";

const INITIAL_STATE: HoldingStateCorrectionActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function HoldingStateCorrectionForm({
  holdingId,
  updatedAt,
  quantity,
  averageCost,
  currency,
}: {
  holdingId: string;
  updatedAt: string;
  quantity: string;
  averageCost: string | null;
  currency: string;
}) {
  const [state, action, pending] = useActionState(
    correctHoldingState,
    INITIAL_STATE,
  );
  const messageId = `holding-correction-${holdingId}`;

  return (
    <details className="min-w-[230px]">
      <summary className="cursor-pointer text-sm font-semibold text-[#1e3a34]">
        수량·평균매입가 정정
      </summary>
      <form action={action} className="mt-3 space-y-3">
        <input name="assetId" type="hidden" value={holdingId} />
        <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />

        <label className="block text-xs font-semibold text-[#35423a]">
          현재 보유 수량
          <input
            aria-describedby={messageId}
            className={fieldClassName}
            defaultValue={quantity}
            inputMode="decimal"
            min="0.000001"
            name="quantity"
            required
            step="0.000001"
            type="number"
          />
        </label>
        <label className="block text-xs font-semibold text-[#35423a]">
          1좌당 평균 매입가 ({currency})
          <input
            aria-describedby={messageId}
            className={fieldClassName}
            defaultValue={averageCost ?? ""}
            inputMode="decimal"
            min="0.0001"
            name="averageCost"
            placeholder="평균 매입가 입력"
            required
            step="0.0001"
            type="number"
          />
        </label>
        <label className="block text-xs font-semibold text-[#35423a]">
          정정 사유 (선택)
          <input
            aria-describedby={messageId}
            className={fieldClassName}
            maxLength={HOLDING_STATE_CORRECTION_POLICY.reasonMaximumLength}
            name="reason"
            placeholder="예: 최초 입력 수량 오기"
            type="text"
          />
        </label>

        <p className="text-xs leading-5 text-[#687064]">
          오입력 정정 전용입니다. 매수·매도 거래나 현금 흐름으로 기록되지
          않습니다.
        </p>
        <button
          className="w-full rounded-md bg-[#1e3a34] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "정정 중" : "현재 상태 정정"}
        </button>
        <p
          aria-live="polite"
          className={[
            "min-h-4 text-xs leading-5",
            state.status === "success" ? "text-[#1e5d49]" : "text-[#8a5b16]",
          ].join(" ")}
          id={messageId}
        >
          {state.message}
        </p>
      </form>
    </details>
  );
}

const fieldClassName =
  "mt-1 w-full rounded-md border border-[#cfd6c8] bg-white px-2 py-1.5 text-right text-sm font-normal tabular-nums text-[#171916] outline-none focus:border-[#1e3a34]";
