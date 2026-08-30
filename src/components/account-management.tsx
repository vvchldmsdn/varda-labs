"use client";

import { useActionState, useEffect, useRef } from "react";

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
  const [state, action, pending] = useActionState(createAccount, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  return (
    <form action={action} className="space-y-3" ref={formRef}>
      <label className="block text-sm font-semibold text-[var(--ink)]">
        Account name
        <input
          className={fieldClassName}
          maxLength={100}
          name="name"
          placeholder="e.g. Mirae Asset, Retirement account"
          required
          type="text"
        />
      </label>
      <p className="text-xs leading-5 text-[var(--muted)]">
        New accounts use KRW as the reporting base. Each holding keeps its own
        market currency, so USD holdings remain supported.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={primaryButtonClassName}
          disabled={pending}
          type="submit"
        >
          {pending ? "Creating..." : "Create account"}
        </button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

export function AccountEditor({ account }: { account: AccountModel }) {
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
        <div>
          <p className="font-semibold text-[var(--ink)]">{account.name}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {account.accountType} / {account.currency}
          </p>
        </div>
        <dl className="flex gap-4 text-right text-xs text-[var(--muted)]">
          <div>
            <dt>Active holdings</dt>
            <dd className="mt-1 font-semibold text-[var(--ink)]">
              {account.activeHoldingCount}
            </dd>
          </div>
          <div>
            <dt>Group references</dt>
            <dd className="mt-1 font-semibold text-[var(--ink)]">
              {account.openGroupReferenceCount}
            </dd>
          </div>
        </dl>
      </div>

      <form action={updateAction} className="mt-4 flex flex-wrap items-end gap-3">
        <IdentityFields account={account} />
        <label className="min-w-56 flex-1 text-sm font-semibold text-[var(--ink)]">
          Display name
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
          {updatePending ? "Saving..." : "Save name"}
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
              Archive this account without deleting its historical evidence.
            </span>
          </label>
          {archiveBlocked ? (
            <p className="mt-2 text-xs text-[var(--warning)]">
              Close or move holdings and remove group references first.
            </p>
          ) : null}
        </div>
        <button
          className={dangerButtonClassName}
          disabled={archiveBlocked || archivePending}
          type="submit"
        >
          {archivePending ? "Archiving..." : "Archive"}
        </button>
        <ActionMessage state={archiveState} />
      </form>
    </article>
  );
}

export function ArchivedAccountRow({ account }: { account: AccountModel }) {
  const [state, action, pending] = useActionState(restoreAccount, INITIAL_STATE);

  return (
    <article className="flex flex-col gap-3 rounded-md border border-[var(--line)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold text-[var(--muted)]">{account.name}</p>
        <p className="mt-1 text-xs text-[var(--faint)]">
          Archived / {account.accountType} / {account.currency}
        </p>
      </div>
      <form action={action} className="flex flex-wrap items-center gap-3">
        <IdentityFields account={account} />
        <button
          className={secondaryButtonClassName}
          disabled={pending}
          type="submit"
        >
          {pending ? "Restoring..." : "Restore"}
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
  return (
    <p
      aria-live="polite"
      className={
        state.status === "success"
          ? "text-sm text-[var(--brand)]"
          : "text-sm text-[var(--warning)]"
      }
    >
      {state.message}
    </p>
  );
}

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm font-normal text-[var(--ink)] outline-none focus:border-[var(--ink)]";
const primaryButtonClassName =
  "rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClassName =
  "rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)] disabled:cursor-not-allowed disabled:opacity-50";
const dangerButtonClassName =
  "rounded-md border border-[var(--warning-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--negative)] disabled:cursor-not-allowed disabled:opacity-50";
