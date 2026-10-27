"use client";

import { useActionFormReset } from "@/components/cairn-ui/client";

import { ManagementText } from "@/components/i18n/management-text";
import { useActionState } from "react";

import {
  updateManualKrxGoldPrice,
  type ManualKrxGoldPriceActionState,
} from "@/app/portfolio/holdings/actions";
import { KRX_GOLD_MANUAL_ASSET_BINDING } from "@/lib/market-data/manual-asset-price";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput , Status as CairnStatus } from "@/components/cairn-ui";


const INITIAL_STATE: ManualKrxGoldPriceActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function ManualKrxGoldPriceForm({
  currentPrice,
}: {
  currentPrice: string;
}) {
  const [state, action, pending] = useActionState(
    updateManualKrxGoldPrice,
    INITIAL_STATE,
  );
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state);

  return (
    <CairnForm action={action} className="mt-3 min-w-[210px] space-y-2" onReset={actionFormOnReset} ref={actionFormRef}>
      <CairnField className="block text-xs font-semibold text-[var(--ink)]"><ManagementText>{"1g 평가액 (KRW)"}</ManagementText><CairnInput
          aria-describedby="manual-gold-price-message"
          className="mt-1 w-full rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[var(--ink)]"
          defaultValue={Number(currentPrice)}
          inputMode="decimal"
          max={KRX_GOLD_MANUAL_ASSET_BINDING.maximumPriceKrwPerG}
          min={KRX_GOLD_MANUAL_ASSET_BINDING.minimumPriceKrwPerG}
          name="currentPrice"
          required
          step="0.0001"
          type="number"
        />
      </CairnField>
      <CairnButton variant="primary"
        className="w-full rounded-md bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        <ManagementText>{pending ? "저장 중" : "수동 평가 저장"}</ManagementText>
      </CairnButton>
      <CairnStatus as="p" tone={state.status === "success" ? "success" : state.message ? "warning" : "neutral"}
        aria-live="polite"
        className={[
          "min-h-4 text-xs",
          state.status === "success" ? "text-[var(--brand)]" : "text-[var(--warning)]",
        ].join(" ")}
        id="manual-gold-price-message"
      >
        <ManagementText>{state.message ?? "저장 전까지 기존 평가액을 계속 사용합니다."}</ManagementText>
      </CairnStatus>
    </CairnForm>
  );
}
