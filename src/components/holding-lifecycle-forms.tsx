"use client";

import { useActionFormReset } from "@/components/cairn-ui/client";

import { ManagementText, ManagementElement } from "@/components/i18n/management-text";
import { useActionState } from "react";
import { NativeLedgerNotice } from "@/components/native-ledger-notice";
import { NATIVE_LEDGER_REQUIRED_MESSAGE } from "@/lib/native-ledger-compatibility";

import {
  archiveHolding,
  restoreHolding,
} from "@/app/portfolio/holdings/actions";
import {
  HOLDING_LIFECYCLE_POLICY,
  type HoldingLifecycleActionState,
} from "@/lib/holding-lifecycle";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput , Status as CairnStatus } from "@/components/cairn-ui";


const INITIAL_STATE: HoldingLifecycleActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function HoldingArchiveForm({
  holdingId,
  updatedAt,
  action: submitAction = archiveHolding,
}: {
  holdingId: string;
  updatedAt: string;
  action?: typeof archiveHolding;
}) {
  const [state, action, pending] = useActionState(submitAction, INITIAL_STATE);
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state);
  const messageId = `holding-archive-${holdingId}`;

  return (
    <details className="mt-3 min-w-[230px] border-t border-[var(--wash)] pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--warning)]"><ManagementText>{"보유 종료"}</ManagementText></summary>
      <CairnForm action={action} className="mt-3 space-y-3" onReset={actionFormOnReset} ref={actionFormRef}>
        <input name="assetId" type="hidden" value={holdingId} />
        <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />
        <CairnField className="block text-xs font-semibold text-[var(--ink)]"><ManagementText>{"종료 메모 (선택)"}</ManagementText><ManagementElement as="input"
            aria-describedby={messageId}
            className={fieldClassName}
            maxLength={HOLDING_LIFECYCLE_POLICY.reasonMaximumLength}
            name="reason"
            placeholder="예: 전량 매도 후 보유 종료"
            type="text"
          />
        </CairnField>
        <CairnField className="flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
          <CairnInput
            className="mt-1"
            name="archiveConfirmed"
            required
            type="checkbox"
            value="yes"
          /><ManagementText>{"현재 계산에서 제외하되 수량·매입원가·과거 기록은 보존합니다."}</ManagementText></CairnField>
        <CairnButton variant="danger"
          className="w-full rounded-md border border-[var(--negative-mid)] bg-white px-3 py-2 text-xs font-semibold text-[var(--warning)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          <ManagementText>{pending ? "종료 중" : "보유 종료"}</ManagementText>
        </CairnButton>
        <ActionMessage id={messageId} state={state} />
      </CairnForm>
    </details>
  );
}

export function HoldingRestoreForm({
  holdingId,
  updatedAt,
  action: submitAction = restoreHolding,
}: {
  holdingId: string;
  updatedAt: string;
  action?: typeof restoreHolding;
}) {
  const [state, action, pending] = useActionState(submitAction, INITIAL_STATE);
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state);
  const messageId = `holding-restore-${holdingId}`;

  return (
    <CairnForm action={action} className="min-w-[210px] space-y-2" onReset={actionFormOnReset} ref={actionFormRef}>
      <input name="assetId" type="hidden" value={holdingId} />
      <input name="expectedUpdatedAt" type="hidden" value={updatedAt} />
      <ManagementElement as="input"
        aria-describedby={messageId}
        className={fieldClassName}
        maxLength={HOLDING_LIFECYCLE_POLICY.reasonMaximumLength}
        name="reason"
        placeholder="복원 메모 (선택)"
        type="text"
      />
      <CairnButton variant="primary"
        className="w-full rounded-md bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        <ManagementText>{pending ? "복원 중" : "보유 복원"}</ManagementText>
      </CairnButton>
      <ActionMessage id={messageId} state={state} />
    </CairnForm>
  );
}

function ActionMessage({
  id,
  state,
}: {
  id: string;
  state: HoldingLifecycleActionState;
}) {
  return (
    <div>
    {state.message === NATIVE_LEDGER_REQUIRED_MESSAGE ? <NativeLedgerNotice /> : null}
    <CairnStatus as="p" tone={state.status === "success" ? "success" : state.message ? "warning" : "neutral"}
      aria-live="polite"
      className={[
        "min-h-4 text-xs leading-5",
        state.status === "success" ? "text-[var(--brand)]" : "text-[var(--warning)]",
      ].join(" ")}
      id={id}
    >
      <ManagementText>{state.message}</ManagementText>
    </CairnStatus>
    </div>
  );
}

const fieldClassName =
  "mt-1 w-full rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-sm font-normal text-[var(--ink)] outline-none focus:border-[var(--ink)]";
