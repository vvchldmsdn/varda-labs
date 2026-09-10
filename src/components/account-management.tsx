"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { accountActionMessageKo, accountTypeLabel } from "@/lib/i18n/account-management-copy";

import {
  archiveAccount,
  createAccount,
  restoreAccount,
  updateAccount,
} from "@/app/portfolio/accounts/actions";
import type { AccountManagementModel } from "@/db/queries/account-management";
import type { AccountManagementActionState } from "@/lib/account-management";

type AccountModel = AccountManagementModel["accounts"][number];

const INITIAL_STATE: AccountManagementActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function AccountCreateForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(createAccount, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  return (
    <form action={action} className="space-y-3" ref={formRef}>
      <label className="block text-sm font-semibold text-[var(--ink)]">
        {t("계좌 이름", "Account name")}
        <input
          className={fieldClassName}
          maxLength={100}
          name="name"
          placeholder={t("예: 내 증권계좌, 연금계좌", "e.g. My brokerage, Retirement account")}
          required
          type="text"
        />
      </label>
      <p className="text-xs leading-5 text-[var(--muted)]">
        {t("평가액은 원화로 표시합니다. 미국 주식 등 외화 종목도 등록할 수 있습니다.", "Valuations are shown in KRW. You can also add holdings in foreign currencies, including US stocks.")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={primaryButtonClassName}
          disabled={pending}
          type="submit"
        >
          {t(pending ? "만드는 중…" : "계좌 만들기", pending ? "Creating…" : "Create account")}
        </button>
        <ActionMessage state={state} />
      </div>
      {state.status === "success" && state.createdAccountId && !pending ? (
        <Link
          className={`inline-flex items-center ${secondaryButtonClassName}`}
          href={{ pathname: "/portfolio/holdings/new", query: { accountId: state.createdAccountId } }}
        >
          {t("이 계좌에 종목 추가", "Add holdings to this account")}
        </Link>
      ) : null}
    </form>
  );
}

export function AccountEditor({ account }: { account: AccountModel }) {
  const { t } = useI18n();
  const [updateState, updateAction, updatePending] = useActionState(
    updateAccount,
    INITIAL_STATE,
  );
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveAccount,
    INITIAL_STATE,
  );
  const archiveBlocked =
    account.activeHoldingCount > 0 || account.openGroupReferenceCount > 0;

  return (
    <article className="rounded-md border border-[var(--line)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-full">
          <p className="break-words font-semibold text-[var(--ink)]">{account.name}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {t(...accountTypeLabel(account.accountType))} / {account.currency}
          </p>
        </div>
        <dl className="flex gap-4 text-right text-xs text-[var(--muted)]">
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
        className={`mt-4 inline-flex items-center ${secondaryButtonClassName}`}
        href={{ pathname: "/portfolio/holdings/new", query: { accountId: account.id } }}
      >
        {t("이 계좌에 종목 추가", "Add holdings to this account")}
      </Link>

      <form action={updateAction} className="mt-4 flex flex-wrap items-end gap-3">
        <IdentityFields account={account} />
        <label className="min-w-0 w-full flex-1 text-sm font-semibold text-[var(--ink)] sm:min-w-56">
          {t("계좌 이름", "Account name")}
          <input
            className={fieldClassName}
            defaultValue={account.name}
            maxLength={100}
            name="name"
            required
            type="text"
          />
        </label>
        <button
          className={secondaryButtonClassName}
          disabled={updatePending}
          type="submit"
        >
          {t(updatePending ? "저장 중…" : "이름 저장", updatePending ? "Saving…" : "Save name")}
        </button>
        <ActionMessage state={updateState} />
      </form>

      <form
        action={archiveAction}
        className="mt-4 flex flex-col gap-3 border-t border-[var(--wash)] pt-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <IdentityFields account={account} />
        <div className="min-w-0 flex-1">
          <label className="flex items-start gap-2 text-sm text-[var(--muted)]">
            <input
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
          </label>
          {archiveBlocked ? (
            <p className="mt-2 text-xs text-[var(--warning)]">
              {t("먼저 보유종목을 이동·종료하고 분석 범위 연결을 해제해 주세요.", "Move or close holdings and remove analysis-scope links first.")}
            </p>
          ) : null}
        </div>
        <button
          className={dangerButtonClassName}
          disabled={archiveBlocked || archivePending}
          type="submit"
        >
          {t(archivePending ? "종료 중…" : "계좌 종료", archivePending ? "Closing…" : "Close account")}
        </button>
        <ActionMessage state={archiveState} />
      </form>
    </article>
  );
}

export function ArchivedAccountRow({ account }: { account: AccountModel }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(restoreAccount, INITIAL_STATE);

  return (
    <article className="flex flex-col gap-3 rounded-md border border-[var(--line)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-words font-semibold text-[var(--muted)]">{account.name}</p>
        <p className="mt-1 text-xs text-[var(--faint)]">
          {t("종료됨", "Closed")} / {t(...accountTypeLabel(account.accountType))} / {account.currency}
        </p>
      </div>
      <form action={action} className="flex flex-wrap items-center gap-3">
        <IdentityFields account={account} />
        <button
          className={secondaryButtonClassName}
          disabled={pending}
          type="submit"
        >
          {t(pending ? "복원 중…" : "복원", pending ? "Restoring…" : "Restore")}
        </button>
        <ActionMessage state={state} />
      </form>
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
    <p
      aria-live="polite"
      className={
        state.status === "success"
          ? "text-sm text-[var(--brand)]"
          : "text-sm text-[var(--warning)]"
      }
    >
      {state.message ? t(accountActionMessageKo(state.message), state.message) : null}
    </p>
  );
}

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm font-normal text-[var(--ink)] outline-none focus:border-[var(--ink)]";
const primaryButtonClassName =
  "min-h-11 rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClassName =
  "min-h-11 rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)] disabled:cursor-not-allowed disabled:opacity-50";
const dangerButtonClassName =
  "min-h-11 rounded-md border border-[var(--warning-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--negative)] disabled:cursor-not-allowed disabled:opacity-50";
