"use client";

import { useActionFormReset } from "@/components/cairn-ui/client";

import { ManagementText, ManagementElement } from "@/components/i18n/management-text";
import { T } from "@/components/i18n/localized-text";
import { useActionState } from "react";
import { NativeLedgerNotice } from "@/components/native-ledger-notice";
import { NATIVE_LEDGER_REQUIRED_MESSAGE } from "@/lib/native-ledger-compatibility";

import { correctHoldingState } from "@/app/portfolio/holdings/actions";
import {
  HOLDING_STATE_CORRECTION_POLICY,
  type HoldingStateCorrectionActionState,
} from "@/lib/holding-state-correction";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, InfoDisclosure, Input as CairnInput , Status as CairnStatus } from "@/components/cairn-ui";
import styles from "@/components/portfolio/management-forms.module.css";


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
  action: submitAction = correctHoldingState,
}: {
  holdingId: string;
  updatedAt: string;
  quantity: string;
  averageCost: string | null;
  currency: string;
  action?: typeof correctHoldingState;
}) {
  const [state, action, pending] = useActionState(
    submitAction,
    INITIAL_STATE,
  );
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state);
  const messageId = `holding-correction-${holdingId}`;

  return (
    <details className={styles.disclosure}>
      <summary><ManagementText>{"수량·평균매입가 정정"}</ManagementText></summary>
      <CairnForm action={action} className={styles.form} onReset={actionFormOnReset} ref={actionFormRef}>
        {state.message === NATIVE_LEDGER_REQUIRED_MESSAGE ? <NativeLedgerNotice assetId={holdingId} action="cost_basis" /> : null}
        <input name="assetId" type="hidden" value={holdingId} />
        <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />

        <CairnField><ManagementText>{"현재 보유 수량"}</ManagementText><CairnInput
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
        </CairnField>
        <CairnField><ManagementText>{"1좌당 평균 매입가 ("}</ManagementText>{currency})
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
        </CairnField>
        <p className={styles.hint}><T ko="매입가 선택 · 비워 두면 기존 값 유지" en="Optional cost · leave blank to keep the saved value" /></p>
        <details className={styles.optional}><summary><T ko="메모 추가" en="Add a note" /></summary>
        <CairnField><ManagementText>{"정정 사유 (선택)"}</ManagementText><ManagementElement as="input"
            aria-describedby={messageId}
            className={fieldClassName}
            maxLength={HOLDING_STATE_CORRECTION_POLICY.reasonMaximumLength}
            name="reason"
            placeholder="예: 최초 입력 수량 오기"
            type="text"
          />
        </CairnField>
        </details>

        <p className="text-xs leading-5 text-[var(--muted)]"><T ko="오입력 정정 전용 · 매매·입출금 기록 아님" en="Input corrections only · not a trade or cash-flow record" /></p>
        <CairnButton variant="primary"
          size="lg"
          disabled={pending}
          type="submit"
        >
          <ManagementText>{pending ? "정정 중" : "현재 상태 정정"}</ManagementText>
        </CairnButton>
        <CairnStatus as="p" tone={state.status === "success" ? "success" : state.message ? "warning" : "neutral"}
          aria-live="polite"
          className={[
            "min-h-4 text-xs leading-5",
            state.status === "success" ? "text-[var(--brand)]" : "text-[var(--warning)]",
          ].join(" ")}
          id={messageId}
        >
          <ManagementText>{state.message}</ManagementText>
        </CairnStatus>
        <InfoDisclosure summary={<T ko="정정 기준" en="How corrections work" />}><p><T ko="매입가만 바꾸면 현재 평가액과 수량은 유지됩니다. 과거 거래와 저장된 평가 기록은 바뀌지 않습니다. 미등록 매입가는 나중에 입력할 수 있습니다." en="Changing only average cost keeps the current value and quantity unchanged. Past trades and saved valuations are not rewritten. You can add an unrecorded cost later." /></p>{currency === "USD" ? <p><T ko="USD 매입가 · 원화 손익은 현재 환율 기준, 매입 이후 환차손익 제외" en="Cost in USD · KRW profit/loss uses current FX and excludes FX gains or losses since purchase" /></p> : null}</InfoDisclosure>
      </CairnForm>
    </details>
  );
}

const fieldClassName =
  "w-full font-normal tabular-nums";
