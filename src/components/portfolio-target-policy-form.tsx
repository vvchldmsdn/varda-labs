"use client";

import { useActionState, useMemo, useState } from "react";

import { savePortfolioTargetPolicy } from "@/app/portfolio/targets/actions";
import type { PortfolioTargetPolicyActionState } from "@/lib/portfolio-target-policy-write";
import type { PortfolioTargetBuyability } from "@/lib/portfolio-target-policy";

type TargetRow = Readonly<{
  accountName: string;
  assetName: string;
  market: string;
  currency: string;
  ticker: string | null;
  buyability: PortfolioTargetBuyability;
  currentValueKrw: number | null;
  targetWeightBps: number;
}>;

const INITIAL_STATE: PortfolioTargetPolicyActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function PortfolioTargetPolicyForm({
  universeHash,
  rows,
  scopeKey,
}: {
  universeHash: string;
  rows: readonly TargetRow[];
  scopeKey: string;
}) {
  const [state, action, pending] = useActionState(
    savePortfolioTargetPolicy,
    INITIAL_STATE,
  );
  const [weights, setWeights] = useState(() =>
    rows.map((row) => formatInputPercent(row.targetWeightBps)),
  );
  const totalBps = useMemo(
    () =>
      weights.reduce((total, value) => {
        const basisPoints = parseDisplayedPercent(value);
        return basisPoints === null ? Number.NaN : total + basisPoints;
      }, 0),
    [weights],
  );
  const totalIsValid = totalBps === 10_000;

  return (
    <form action={action} className="mt-5 space-y-4">
      <input name="scope" type="hidden" value={scopeKey} />
      <input name="rowCount" type="hidden" value={rows.length} />
      <input name="universeHash" type="hidden" value={universeHash} />

      <div className="overflow-x-auto rounded-md border border-[var(--line)] bg-white">
        <table className="w-full min-w-[850px] border-collapse text-sm">
          <thead className="bg-[var(--wash)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th className="px-3 py-3">종목</th>
              <th className="px-3 py-3">계좌</th>
              <th className="px-3 py-3">시장</th>
              <th className="px-3 py-3 text-right">현재 평가액</th>
              <th className="px-3 py-3 text-right">목표 비중</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const buyable = row.buyability === "buyable";
              return (
                <tr
                  className="border-t border-[var(--wash)]"
                  key={`${row.accountName}:${row.market}:${row.currency}:${row.ticker ?? row.assetName}`}
                >
                  <td className="px-3 py-3">
                    <p className="font-semibold">{row.ticker ?? row.assetName}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {row.assetName}
                    </p>
                  </td>
                  <td className="px-3 py-3">{row.accountName}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">
                    {row.market} · {row.currency}
                    {!buyable ? (
                      <span className="ml-2 text-[var(--warning)]">목표 0%만 가능</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatKrw(row.currentValueKrw)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <label className="inline-flex items-center gap-2">
                      <span className="sr-only">
                        {row.ticker ?? row.assetName} 목표 비중
                      </span>
                      <input
                        className="w-24 rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-right font-semibold outline-none focus:border-[var(--ink)] disabled:bg-[var(--wash)]"
                        disabled={!buyable || pending}
                        inputMode="decimal"
                        max="100"
                        min="0"
                        name={`targetWeight:${index}`}
                        onChange={(event) => {
                          const next = [...weights];
                          next[index] = event.target.value;
                          setWeights(next);
                        }}
                        required
                        step="0.01"
                        type="number"
                        value={buyable ? weights[index] : "0"}
                      />
                      {!buyable ? (
                        <input name={`targetWeight:${index}`} type="hidden" value="0" />
                      ) : null}
                      <span className="text-[var(--muted)]">%</span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-[var(--line)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">
            합계 {Number.isFinite(totalBps) ? formatPercent(totalBps) : "입력 확인"}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            정확히 100%인 비중만 저장합니다. 이 값은 추천이나 주문이 아니라 사용자가 정한 기준입니다.
          </p>
        </div>
        <button
          className="rounded-md bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending || !totalIsValid || rows.length === 0}
          type="submit"
        >
          {pending ? "저장 중" : "목표비중 저장"}
        </button>
      </div>

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
    </form>
  );
}

function parseDisplayedPercent(value: string) {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const basisPoints =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return basisPoints <= 10_000 ? basisPoints : null;
}

function formatInputPercent(basisPoints: number) {
  return (basisPoints / 100).toFixed(2).replace(/\.00$/, "");
}

function formatPercent(basisPoints: number) {
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(basisPoints / 100)}%`;
}

function formatKrw(value: number | null) {
  return value === null
    ? "가격 근거 없음"
    : `₩${new Intl.NumberFormat("ko-KR", {
        maximumFractionDigits: 0,
      }).format(value)}`;
}
