"use client";

import { ManagementText, ManagementElement } from "@/components/i18n/management-text";
import { T } from "@/components/i18n/localized-text";
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
      <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]"><ManagementText>{"수량·평균매입가 정정"}</ManagementText></summary>
      <form action={action} className="mt-3 space-y-3">
        <input name="assetId" type="hidden" value={holdingId} />
        <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />

        <label className="block text-xs font-semibold text-[var(--ink)]"><ManagementText>{"현재 보유 수량"}</ManagementText><input
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
        <label className="block text-xs font-semibold text-[var(--ink)]"><ManagementText>{"1좌당 평균 매입가 ("}</ManagementText>{currency})
          <ManagementElement as="input"
            aria-describedby={messageId}
            className={fieldClassName}
            defaultValue={averageCost ?? ""}
            inputMode="decimal"
            min="0.0001"
            name="averageCost"
            placeholder="평균 매입가 입력"
            step="0.0001"
            type="number"
          />
        </label>
        <p className="text-xs leading-5 text-[var(--muted)]"><T ko="매입가는 선택입니다. 비워 두면 기존 값을 유지하며, 미등록 상태라면 나중에 입력할 수 있습니다." en="Average cost is optional. Leave it blank to keep the saved value, or add it later if it is not recorded yet." /></p>
        {currency === "USD" ? <p className="text-xs leading-5 text-[var(--muted)]"><T ko="달러 기준 1좌당 매입가를 입력하세요. 현재 보유손익의 원화 환산에는 현재 환율을 사용하므로, 매입 당시 환율에 따른 환차손익은 포함하지 않습니다." en="Enter the purchase price per unit in USD. Current holding profit/loss is converted to KRW at the current exchange rate, so it excludes FX gains or losses since purchase." /></p> : null}
        <p className="text-xs leading-5 text-[var(--muted)]"><T ko="매입가만 바꾸면 현재 평가액과 수량은 유지됩니다. 과거 거래와 저장된 평가 기록은 바뀌지 않습니다." en="Changing only average cost keeps the current value and quantity unchanged. Past trades and saved valuations are not rewritten." /></p>
        <label className="block text-xs font-semibold text-[var(--ink)]"><ManagementText>{"정정 사유 (선택)"}</ManagementText><ManagementElement as="input"
            aria-describedby={messageId}
            className={fieldClassName}
            maxLength={HOLDING_STATE_CORRECTION_POLICY.reasonMaximumLength}
            name="reason"
            placeholder="예: 최초 입력 수량 오기"
            type="text"
          />
        </label>

        <p className="text-xs leading-5 text-[var(--muted)]"><ManagementText>{"오입력 정정 전용입니다. 매수·매도 거래나 현금 흐름으로 기록되지 않습니다."}</ManagementText></p>
        <button
          className="w-full rounded-md bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          <ManagementText>{pending ? "정정 중" : "현재 상태 정정"}</ManagementText>
        </button>
        <p
          aria-live="polite"
          className={[
            "min-h-4 text-xs leading-5",
            state.status === "success" ? "text-[var(--brand)]" : "text-[var(--warning)]",
          ].join(" ")}
          id={messageId}
        >
          <ManagementText>{state.message}</ManagementText>
        </p>
      </form>
    </details>
  );
}

const fieldClassName =
  "mt-1 w-full rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-right text-sm font-normal tabular-nums text-[var(--ink)] outline-none focus:border-[var(--ink)]";
