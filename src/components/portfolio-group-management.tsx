"use client";

import { useActionFormReset } from "@/components/cairn-ui/client";

import { ManagementText } from "@/components/i18n/management-text";
import { useActionState } from "react";

import {
  archivePortfolioGroup,
  savePortfolioGroup,
} from "@/app/portfolio/groups/actions";
import type { PortfolioGroupManagementModel } from "@/db/queries/portfolio-group-management";
import type { PortfolioGroupManagementActionState } from "@/lib/portfolio-group-management";
import { Button as CairnButton, Field as CairnField, Fieldset as CairnFieldset, Form as CairnForm, Input as CairnInput, Textarea as CairnTextarea , Status as CairnStatus } from "@/components/cairn-ui";


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
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state, { resetOnSuccess: true });

  return (
    <CairnForm action={action} className="space-y-4" ref={actionFormRef} onReset={actionFormOnReset}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <TextFields />
        <MembershipFields accounts={accounts} assets={assets} />
      </div>
      <FormFooter
        pending={pending}
        state={state}
        submitLabel="분석 범위 만들기"
      />
    </CairnForm>
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
  const {formRef: saveActionFormRef, onReset: saveActionFormOnReset} = useActionFormReset(saveState);
  const [archiveState, archiveAction, archivePending] = useActionState(
    archivePortfolioGroup,
    INITIAL_STATE,
  );
  const {formRef: archiveActionFormRef, onReset: archiveActionFormOnReset} = useActionFormReset(archiveState);

  return (
    <article className="rounded-md border border-[var(--line)] bg-white p-4">
      <CairnForm action={saveAction} className="space-y-4" onReset={saveActionFormOnReset} ref={saveActionFormRef}>
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
      </CairnForm>

      <CairnForm
        action={archiveAction}
        className="mt-4 flex flex-col gap-3 border-t border-[var(--wash)] pt-4 sm:flex-row sm:items-center sm:justify-between" onReset={archiveActionFormOnReset} ref={archiveActionFormRef}
      >
        <input name="groupId" type="hidden" value={group.id} />
        <input
          name="expectedUpdatedAt"
          type="hidden"
          value={group.updatedAt}
        />
        <CairnField className="flex items-start gap-2 text-sm text-[var(--muted)]">
          <CairnInput
            className="mt-0.5 h-4 w-4 accent-[var(--negative)]"
            name="archiveConfirmed"
            required
            type="checkbox"
            value="yes"
          />
          <span><ManagementText>{"과거 기록을 유지한 채 이 분석 범위를 목록에서 삭제합니다."}</ManagementText></span>
        </CairnField>
        <CairnButton variant="danger"
          className="rounded-md border border-[var(--warning-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--negative)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={archivePending}
          type="submit"
        >
          <ManagementText>{archivePending ? "삭제 중" : "분석 범위 삭제"}</ManagementText>
        </CairnButton>
        <ActionMessage state={archiveState} />
      </CairnForm>
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
      <CairnField className="block text-sm font-semibold text-[var(--ink)]"><ManagementText>{"분석 범위 이름"}</ManagementText><CairnInput
          className={fieldClassName}
          defaultValue={name}
          maxLength={100}
          name="name"
          required
          type="text"
        />
      </CairnField>
      <CairnField className="block text-sm font-semibold text-[var(--ink)]"><ManagementText>{"설명 (선택)"}</ManagementText><CairnTextarea
          className={`${fieldClassName} min-h-24 resize-y`}
          defaultValue={description}
          maxLength={500}
          name="description"
        />
      </CairnField>
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
      <CairnFieldset>
        <legend className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"계좌 전체 포함"}</ManagementText></legend>
        <p className="mt-1 text-xs text-[var(--muted)]"><ManagementText>{"선택한 계좌에 나중에 추가되는 종목도 자동으로 이 분석 범위에 포함됩니다."}</ManagementText></p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {accounts.map((account) => (
            <CairnField className={checkboxClassName} key={account.id}>
              <CairnInput
                className="h-4 w-4 accent-[var(--ink)]"
                defaultChecked={accountSelection.has(account.id)}
                name="accountId"
                type="checkbox"
                value={account.id}
              />
              <span>
                <strong className="block text-[var(--ink)]">{account.name}</strong>
              </span>
            </CairnField>
          ))}
        </div>
      </CairnFieldset>

      <CairnFieldset>
        <legend className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"개별 종목 포함"}</ManagementText></legend>
        <p className="mt-1 text-xs text-[var(--muted)]"><ManagementText>{"계좌 전체와 겹치는 개별 선택은 저장할 때 자동으로 정리됩니다."}</ManagementText></p>
        <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {assets.length === 0 ? (
            <p className="text-sm text-[var(--muted)]"><ManagementText>{"선택할 보유종목이 없습니다."}</ManagementText></p>
          ) : (
            assets.map((asset) => (
              <CairnField className={checkboxClassName} key={asset.id}>
                <CairnInput
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
              </CairnField>
            ))
          )}
        </div>
      </CairnFieldset>
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
      <CairnButton variant="primary"
        className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        <ManagementText>{pending ? "저장 중" : submitLabel}</ManagementText>
      </CairnButton>
      <ActionMessage state={state} />
    </div>
  );
}

function ActionMessage({ state }: { state: PortfolioGroupManagementActionState }) {
  return (
    <CairnStatus as="p" tone={state.status === "success" ? "success" : state.message ? "warning" : "neutral"}
      aria-live="polite"
      className={
        state.status === "success"
          ? "text-sm text-[var(--brand)]"
          : "text-sm text-[var(--warning)]"
      }
    >
      <ManagementText>{state.message}</ManagementText>
    </CairnStatus>
  );
}

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm font-normal text-[var(--ink)] outline-none focus:border-[var(--ink)]";
const checkboxClassName =
  "flex min-w-0 items-start gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm";
