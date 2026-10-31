"use client";

import { useActionFormReset } from "@/components/cairn-ui/client";

import Link from "next/link";
import { NATIVE_ACCOUNT_BALANCE_MESSAGE } from "@/lib/native-ledger-compatibility";
import { useActionState } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { accountActionMessageKo, accountTypeLabel } from "@/lib/i18n/account-management-copy";
import styles from "@/components/portfolio/management-forms.module.css";

import {
  archiveAccount,
  createAccount,
  restoreAccount,
  updateAccount,
} from "@/app/portfolio/accounts/actions";
import type { AccountManagementModel } from "@/db/queries/account-management";
import type { AccountManagementActionState } from "@/lib/account-management";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput , Status as CairnStatus } from "@/components/cairn-ui";


type AccountModel = AccountManagementModel["accounts"][number];

const INITIAL_STATE: AccountManagementActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function AccountCreateForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(createAccount, INITIAL_STATE);
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state, { resetOnSuccess: true });

  return (
    <CairnForm action={action} className={styles.form} ref={actionFormRef} onReset={actionFormOnReset}>
      <CairnField className="block text-sm font-semibold text-[var(--ink)]">
        {t("계좌 이름", "Account name")}
        <CairnInput
          className={fieldClassName}
          maxLength={100}
          name="name"
          placeholder={t("예: 내 증권계좌, 연금계좌", "e.g. My brokerage, Retirement account")}
          required
          type="text"
        />
      </CairnField>
      <p className={styles.hint}>
        {t("원화 기준 · 미국 주식도 담을 수 있어요.", "Reported in KRW · US holdings welcome.")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <CairnButton variant="primary"
          size="lg"
          disabled={pending}
          type="submit"
        >
          {t(pending ? "만드는 중…" : "계좌 만들기", pending ? "Creating…" : "Create account")}
        </CairnButton>
        <ActionMessage state={state} />
      </div>
      {state.status === "success" && state.createdAccountId && !pending ? (
        <Link
          className={styles.link}
          href={{ pathname: "/portfolio/holdings/new", query: { accountId: state.createdAccountId } }}
        >
          {t("이 계좌에 종목 추가", "Add holdings to this account")}
        </Link>
      ) : null}
    </CairnForm>
  );
}

export function AccountEditor({ account }: { account: AccountModel }) {
  const { t } = useI18n();
  const [updateState, updateAction, updatePending] = useActionState(
    updateAccount,
    INITIAL_STATE,
  );
  const {formRef: updateActionFormRef, onReset: updateActionFormOnReset} = useActionFormReset(updateState);
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveAccount,
    INITIAL_STATE,
  );
  const {formRef: archiveActionFormRef, onReset: archiveActionFormOnReset} = useActionFormReset(archiveState);
  const archiveBlocked =
    account.activeHoldingCount > 0 || account.openGroupReferenceCount > 0;

  return (
    <article className={styles.card}>
      <div className={styles.heading}>
        <div className="min-w-0 max-w-full">
          <h3>{account.name}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t(...accountTypeLabel(account.accountType))} / {account.currency}
          </p>
        </div>
        <dl className={styles.counts}>
          <div>
            <dt>{t("보유 종목", "Holdings")}</dt>
            <dd className="mt-1 font-semibold text-[var(--ink)]">
              {account.activeHoldingCount}
            </dd>
          </div>
          <div>
            <dt>{t("연결된 분석 범위", "Linked scopes")}</dt>
            <dd className="mt-1 font-semibold text-[var(--ink)]">
              {account.openGroupReferenceCount}
            </dd>
          </div>
        </dl>
      </div>

      <Link
        className={styles.link}
        href={{ pathname: "/portfolio/holdings/new", query: { accountId: account.id } }}
      >
        {t("이 계좌에 종목 추가", "Add holdings to this account")}
      </Link>

      <CairnForm action={updateAction} className={styles.inlineForm} onReset={updateActionFormOnReset} ref={updateActionFormRef}>
        <IdentityFields account={account} />
        <CairnField className="min-w-0 w-full flex-1 text-sm font-semibold text-[var(--ink)] sm:min-w-56">
          {t("계좌 이름", "Account name")}
          <CairnInput
            className={fieldClassName}
            defaultValue={account.name}
            maxLength={100}
            name="name"
            required
            type="text"
          />
        </CairnField>
        <CairnButton variant="primary"
          disabled={updatePending}
          type="submit"
        >
          {t(updatePending ? "저장 중…" : "이름 저장", updatePending ? "Saving…" : "Save name")}
        </CairnButton>
        <ActionMessage state={updateState} />
      </CairnForm>

      <details className={`${styles.disclosure} ${styles.danger}`}>
        <summary>{t("계좌 종료", "Close account")}</summary>
      <CairnForm
        action={archiveAction}
        className={styles.form} onReset={archiveActionFormOnReset} ref={archiveActionFormRef}
      >
        <IdentityFields account={account} />
        <div className="min-w-0 flex-1">
          <CairnField className={styles.confirmation}>
            <CairnInput
              className="mt-0.5 h-4 w-4 accent-[var(--negative)]"
              disabled={archiveBlocked}
              name="archiveConfirmed"
              required
              type="checkbox"
              value="yes"
            />
            <span>
              {t("과거 기록을 보존하고 이 계좌를 종료합니다.", "Close this account while keeping its historical records.")}
            </span>
          </CairnField>
          {archiveBlocked ? (
            <p className="mt-2 text-xs text-[var(--warning)]">
              {t("먼저 보유종목을 이동·종료하고 분석 범위 연결을 해제해 주세요.", "Move or close holdings and remove analysis-scope links first.")}
            </p>
          ) : null}
        </div>
        <CairnButton variant="danger"
          disabled={archiveBlocked || archivePending}
          type="submit"
        >
          {t(archivePending ? "종료 중…" : "계좌 종료", archivePending ? "Closing…" : "Close account")}
        </CairnButton>
        <ActionMessage state={archiveState} />
      </CairnForm>
      </details>
    </article>
  );
}

export function ArchivedAccountRow({ account }: { account: AccountModel }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(restoreAccount, INITIAL_STATE);
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state);

  return (
    <article className={`${styles.card} ${styles.archived}`}>
      <div className="min-w-0">
        <p className="break-words font-semibold text-[var(--muted)]">{account.name}</p>
        <p className="mt-1 text-xs text-[var(--faint)]">
          {t("종료됨", "Closed")} / {t(...accountTypeLabel(account.accountType))} / {account.currency}
        </p>
      </div>
      <CairnForm action={action} className={styles.form} onReset={actionFormOnReset} ref={actionFormRef}>
        <IdentityFields account={account} />
        <CairnButton variant="primary"
          disabled={pending}
          type="submit"
        >
          {t(pending ? "복원 중…" : "복원", pending ? "Restoring…" : "Restore")}
        </CairnButton>
        <ActionMessage state={state} />
      </CairnForm>
    </article>
  );
}

function IdentityFields({ account }: { account: AccountModel }) {
  return (
    <>
      <input name="accountId" type="hidden" value={account.id} />
      <input
        name="expectedUpdatedAt"
        type="hidden"
        value={account.updatedAt}
      />
    </>
  );
}

function ActionMessage({ state }: { state: AccountManagementActionState }) {
  const { t } = useI18n();
  return (
    <CairnStatus as="p" tone={state.status === "success" ? "success" : state.message ? "warning" : "neutral"}
      aria-live="polite"
      className={
        state.status === "success"
          ? "text-sm text-[var(--brand)]"
          : "text-sm text-[var(--warning)]"
      }
    >
      {state.message ? t(accountActionMessageKo(state.message), state.message) : null}
      {state.message === NATIVE_ACCOUNT_BALANCE_MESSAGE ? <Link className="block py-2 underline underline-offset-4" href="/portfolio/ledger">{t("거래·현금 원장에서 확인하기", "Review holdings & cash")}</Link> : null}
    </CairnStatus>
  );
}

const fieldClassName = "w-full font-normal";
