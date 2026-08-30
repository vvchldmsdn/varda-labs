"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  archivePortfolioGroup,
  savePortfolioGroup,
} from "@/app/portfolio/groups/actions";
import type { PortfolioGroupManagementModel } from "@/db/queries/portfolio-group-management";
import type { PortfolioGroupManagementActionState } from "@/lib/portfolio-group-management";

type AccountOption = PortfolioGroupManagementModel["accounts"][number];
type AssetOption = PortfolioGroupManagementModel["assets"][number];
type GroupModel = PortfolioGroupManagementModel["groups"][number];

const INITIAL_STATE: PortfolioGroupManagementActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function PortfolioGroupCreateForm({
  accounts,
  assets,
}: {
  accounts: readonly AccountOption[];
  assets: readonly AssetOption[];
}) {
  const [state, action, pending] = useActionState(
    savePortfolioGroup,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  return (
    <form action={action} className="space-y-4" ref={formRef}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <TextFields />
        <MembershipFields accounts={accounts} assets={assets} />
      </div>
      <FormFooter
        pending={pending}
        state={state}
        submitLabel="그룹 만들기"
      />
    </form>
  );
}

export function PortfolioGroupEditor({
  accounts,
  assets,
  group,
}: {
  accounts: readonly AccountOption[];
  assets: readonly AssetOption[];
  group: GroupModel;
}) {
  const [saveState, saveAction, savePending] = useActionState(
    savePortfolioGroup,
    INITIAL_STATE,
  );
  const [archiveState, archiveAction, archivePending] = useActionState(
    archivePortfolioGroup,
    INITIAL_STATE,
  );

  return (
    <article className="rounded-md border border-[var(--line)] bg-white p-4">
      <form action={saveAction} className="space-y-4">
        <input name="groupId" type="hidden" value={group.id} />
        <input
          name="expectedUpdatedAt"
          type="hidden"
          value={group.updatedAt}
        />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <TextFields
            description={group.description ?? ""}
            name={group.name}
          />
          <MembershipFields
            accounts={accounts}
            assets={assets}
            selectedAccountIds={group.accountIds}
            selectedAssetIds={group.assetIds}
          />
        </div>
        <FormFooter
          pending={savePending}
          state={saveState}
          submitLabel="변경 저장"
        />
      </form>

      <form
        action={archiveAction}
        className="mt-4 flex flex-col gap-3 border-t border-[var(--wash)] pt-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <input name="groupId" type="hidden" value={group.id} />
        <input
          name="expectedUpdatedAt"
          type="hidden"
          value={group.updatedAt}
        />
        <label className="flex items-start gap-2 text-sm text-[var(--muted)]">
          <input
            className="mt-0.5 h-4 w-4 accent-[var(--negative)]"
            name="archiveConfirmed"
            required
            type="checkbox"
            value="yes"
          />
          <span>과거 기록을 유지한 채 이 그룹을 목록에서 삭제합니다.</span>
        </label>
        <button
          className="rounded-md border border-[var(--warning-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--negative)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={archivePending}
          type="submit"
        >
          {archivePending ? "삭제 중" : "그룹 삭제"}
        </button>
        <ActionMessage state={archiveState} />
      </form>
    </article>
  );
}

function TextFields({
  description = "",
  name = "",
}: {
  description?: string;
  name?: string;
}) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-[var(--ink)]">
        그룹 이름
        <input
          className={fieldClassName}
          defaultValue={name}
          maxLength={100}
          name="name"
          required
          type="text"
        />
      </label>
      <label className="block text-sm font-semibold text-[var(--ink)]">
        설명 (선택)
        <textarea
          className={`${fieldClassName} min-h-24 resize-y`}
          defaultValue={description}
          maxLength={500}
          name="description"
        />
      </label>
    </div>
  );
}

function MembershipFields({
  accounts,
  assets,
  selectedAccountIds = [],
  selectedAssetIds = [],
}: {
  accounts: readonly AccountOption[];
  assets: readonly AssetOption[];
  selectedAccountIds?: readonly string[];
  selectedAssetIds?: readonly string[];
}) {
  const accountSelection = new Set(selectedAccountIds);
  const assetSelection = new Set(selectedAssetIds);

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-semibold text-[var(--ink)]">
          계좌 전체 포함
        </legend>
        <p className="mt-1 text-xs text-[var(--muted)]">
          선택한 계좌에 나중에 추가되는 종목도 자동으로 이 그룹에 포함됩니다.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {accounts.map((account) => (
            <label className={checkboxClassName} key={account.id}>
              <input
                className="h-4 w-4 accent-[var(--ink)]"
                defaultChecked={accountSelection.has(account.id)}
                name="accountId"
                type="checkbox"
                value={account.id}
              />
              <span>
                <strong className="block text-[var(--ink)]">{account.name}</strong>
                <span className="text-xs text-[var(--muted)]">{account.code}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-[var(--ink)]">
          개별 종목 포함
        </legend>
        <p className="mt-1 text-xs text-[var(--muted)]">
          계좌 전체와 겹치는 개별 선택은 저장할 때 자동으로 정리됩니다.
        </p>
        <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {assets.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">선택할 보유종목이 없습니다.</p>
          ) : (
            assets.map((asset) => (
              <label className={checkboxClassName} key={asset.id}>
                <input
                  className="h-4 w-4 accent-[var(--ink)]"
                  defaultChecked={assetSelection.has(asset.id)}
                  name="assetId"
                  type="checkbox"
                  value={asset.id}
                />
                <span className="min-w-0">
                  <strong className="block truncate text-[var(--ink)]">
                    {asset.ticker ?? asset.name}
                  </strong>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {asset.accountName} · {asset.name}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
      </fieldset>
    </div>
  );
}

function FormFooter({
  pending,
  state,
  submitLabel,
}: {
  pending: boolean;
  state: PortfolioGroupManagementActionState;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--wash)] pt-4">
      <button
        className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "저장 중" : submitLabel}
      </button>
      <ActionMessage state={state} />
    </div>
  );
}

function ActionMessage({ state }: { state: PortfolioGroupManagementActionState }) {
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
const checkboxClassName =
  "flex min-w-0 items-start gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm";
