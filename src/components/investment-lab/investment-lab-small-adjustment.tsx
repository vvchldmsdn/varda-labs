"use client";

import { useState, type FormEvent } from "react";

import { InvestmentLabSmallAdjustmentResult } from "./investment-lab-small-adjustment-result";
import {
  calculateInvestmentLabSmallAdjustment,
  type InvestmentLabSmallAdjustmentAccount,
  type InvestmentLabSmallAdjustmentAccountBlocker,
  type InvestmentLabSmallAdjustmentCalculation,
  type InvestmentLabSmallAdjustmentModel,
} from "@/lib/investment-lab-small-adjustment";

const ACCOUNT_LABELS: Record<InvestmentLabSmallAdjustmentAccount, string> = {
  brokerage: "증권",
  isa: "ISA",
  irp: "IRP",
};

export function InvestmentLabSmallAdjustment({
  model,
}: {
  model: InvestmentLabSmallAdjustmentModel;
}) {
  const [accountCode, setAccountCode] =
    useState<InvestmentLabSmallAdjustmentAccount>("brokerage");
  const [sourceKey, setSourceKey] = useState("");
  const [destinationKey, setDestinationKey] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] =
    useState<InvestmentLabSmallAdjustmentCalculation | null>(null);
  const selectedAccount =
    model.accounts.find((row) => row.account === accountCode) ??
    model.accounts[0];
  const source = selectedAccount?.holdings.find((row) => row.key === sourceKey);
  const readyAccountCount = model.accounts.filter(
    (row) => row.status === "ready",
  ).length;

  function resetCalculation() {
    setSourceKey("");
    setDestinationKey("");
    setAmount("");
    setResult(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    setResult(
      calculateInvestmentLabSmallAdjustment({
        account: selectedAccount,
        sourceKey,
        destinationKey,
        transferAmountKrw: Number(amount.replaceAll(",", "")),
      }),
    );
  }

  return (
    <section
      aria-labelledby="investment-lab-small-adjustment-title"
      className="mx-auto w-full max-w-[1500px] space-y-4 px-4 pb-4"
      data-adjustment-account-count={model.accounts.length}
      data-adjustment-policy={model.policy.version}
      data-adjustment-ready-accounts={readyAccountCount}
      data-persistence={model.policy.persistence}
      data-section="investment-lab-small-adjustment"
    >
      <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-[#687064]">What-if</p>
            <h2
              id="investment-lab-small-adjustment-title"
              className="mt-1 text-xl font-semibold sm:text-2xl"
            >
              작은 조정 영향 실험
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#626b5f]">
              같은 계정의 두 보유자산 사이에서 지정 금액만 옮긴 가정입니다.
              외부 현금, 목표비중, 추천, 주문은 반영하지 않습니다.
            </p>
          </div>
          <p className="text-sm font-semibold text-[#3f4b40]">
            계산 가능 계정 {readyAccountCount}/{model.accounts.length}
          </p>
        </div>
      </header>

      <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <div
          aria-label="조정 계정"
          className="grid grid-cols-3 gap-1 rounded-md border border-[#d9ded3] bg-white p-1 sm:w-[360px]"
          role="group"
        >
          {model.accounts.map((account) => (
            <button
              className={`min-h-10 rounded px-3 text-sm font-semibold ${
                account.account === accountCode
                  ? "bg-[#173f39] text-white"
                  : "text-[#4e584d] hover:bg-[#eef2e8]"
              }`}
              key={account.account}
              onClick={() => {
                setAccountCode(account.account);
                resetCalculation();
              }}
              type="button"
            >
              {ACCOUNT_LABELS[account.account]}
            </button>
          ))}
        </div>

        {!selectedAccount || selectedAccount.status !== "ready" ? (
          <AccountUnavailable account={selectedAccount} />
        ) : (
          <form className="mt-4 space-y-4" onSubmit={submit}>
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_220px_auto] lg:items-end">
              <label className="grid gap-1.5 text-sm font-semibold text-[#3f493e]">
                줄일 보유자산
                <select
                  className="min-h-11 w-full rounded-md border border-[#cfd6ca] bg-white px-3 font-normal text-[#171916]"
                  onChange={(event) => {
                    setSourceKey(event.target.value);
                    setResult(null);
                  }}
                  value={sourceKey}
                >
                  <option value="">선택 안 함</option>
                  {selectedAccount.holdings.map((holding) => (
                    <option key={holding.key} value={holding.key}>
                      {holdingLabel(holding)} · {formatKrw(holding.currentValueKrw)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-sm font-semibold text-[#3f493e]">
                늘릴 보유자산
                <select
                  className="min-h-11 w-full rounded-md border border-[#cfd6ca] bg-white px-3 font-normal text-[#171916]"
                  onChange={(event) => {
                    setDestinationKey(event.target.value);
                    setResult(null);
                  }}
                  value={destinationKey}
                >
                  <option value="">선택 안 함</option>
                  {selectedAccount.holdings.map((holding) => (
                    <option
                      disabled={holding.key === sourceKey}
                      key={holding.key}
                      value={holding.key}
                    >
                      {holdingLabel(holding)} · {formatKrw(holding.currentValueKrw)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-sm font-semibold text-[#3f493e]">
                이동 금액
                <input
                  className="min-h-11 w-full rounded-md border border-[#cfd6ca] bg-white px-3 font-normal tabular-nums text-[#171916]"
                  inputMode="numeric"
                  max={source ? Math.floor(source.currentValueKrw) : undefined}
                  min="1"
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setResult(null);
                  }}
                  placeholder="0"
                  step="1"
                  type="number"
                  value={amount}
                />
              </label>

              <button
                className="min-h-11 rounded-md bg-[#173f39] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9ca59a]"
                disabled={!sourceKey || !destinationKey || !amount}
                type="submit"
              >
                영향 계산
              </button>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#687064]">
              <span>계정 평가액 {formatKrw(selectedAccount.totalValueKrw)}</span>
              <span>직접 보유 {selectedAccount.holdings.length}개</span>
              {source ? (
                <span>이동 가능 상한 {formatKrw(source.currentValueKrw)}</span>
              ) : null}
            </div>
          </form>
        )}
      </div>

      {result ? <InvestmentLabSmallAdjustmentResult result={result} /> : null}
    </section>
  );
}

function AccountUnavailable({
  account,
}: {
  account: InvestmentLabSmallAdjustmentModel["accounts"][number] | undefined;
}) {
  return (
    <div className="mt-4 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-4 py-3 text-sm text-[#725f2d]">
      <p className="font-semibold">이 계정은 조정 계산을 차단했습니다.</p>
      <ul className="mt-2 space-y-1">
        {(account?.blockers ?? []).map((blocker) => (
          <li key={blocker}>{accountBlockerLabel(blocker)}</li>
        ))}
      </ul>
      {account?.excludedHoldingCount ? (
        <p className="mt-2 text-xs">
          평가 제외 {account.excludedHoldingCount}개 · 가격 {" "}
          {account.exclusionReasonCounts.missingPrice} · 환율 {" "}
          {account.exclusionReasonCounts.missingFx} · 미지원 통화 {" "}
          {account.exclusionReasonCounts.unsupportedCurrency}
        </p>
      ) : null}
      {account?.unresolvedInstrumentCount ? (
        <p className="mt-2 text-xs">
          식별 불가 직접 보유 {account.unresolvedInstrumentCount}개
        </p>
      ) : null}
    </div>
  );
}

export function InvestmentLabSmallAdjustmentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-4">
      <div className="h-64 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </div>
  );
}

export function InvestmentLabSmallAdjustmentUnavailable() {
  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 pb-4">
      <div className="rounded-lg border border-[#eadfbe] bg-[#fff9e8] p-4 text-sm text-[#725f2d]">
        <h2 className="text-lg font-semibold">작은 조정 영향 실험</h2>
        <p className="mt-2">현재 보유자산 평가 근거를 읽지 못해 계산을 차단했습니다.</p>
      </div>
    </section>
  );
}

function holdingLabel(holding: { name: string; ticker: string | null }) {
  return holding.ticker ? `${holding.ticker} · ${holding.name}` : holding.name;
}

function accountBlockerLabel(
  blocker: InvestmentLabSmallAdjustmentAccountBlocker,
) {
  switch (blocker) {
    case "incomplete_valuation_coverage":
      return "가격·환율 근거가 없는 보유자산이 있어 계정 전체 비교가 불완전합니다.";
    case "unresolved_holding_identity":
      return "계정·시장·통화·티커 중 식별 정보가 없는 보유자산이 있어 계산을 차단했습니다.";
    case "insufficient_holdings":
      return "평가 가능한 직접 보유자산이 두 개보다 적습니다.";
    case "invalid_portfolio_values":
      return "현재 평가액 입력을 안전하게 계산할 수 없습니다.";
  }
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}
