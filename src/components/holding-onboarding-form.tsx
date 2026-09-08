"use client";

import { ManagementText, ManagementElement } from "@/components/i18n/management-text";
import Link from "next/link";
import { useActionState, useState } from "react";

import { createHoldingOnboarding } from "@/app/portfolio/holdings/new/actions";
import type { HoldingOnboardingOptions } from "@/db/queries/holding-onboarding";
import {
  HOLDING_ONBOARDING_ASSET_TYPES,
  HOLDING_ONBOARDING_MARKETS,
  type HoldingOnboardingActionState,
} from "@/lib/holding-onboarding";

const INITIAL_STATE: HoldingOnboardingActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function HoldingOnboardingForm({
  options,
}: {
  options: HoldingOnboardingOptions;
}) {
  const [state, action, pending] = useActionState(
    createHoldingOnboarding,
    INITIAL_STATE,
  );
  const [market, setMarket] = useState("korea");
  const currency =
    HOLDING_ONBOARDING_MARKETS.find(({ value }) => value === market)
      ?.currency ?? "KRW";

  return (
    <form action={action} className="mt-6 space-y-6">
      <fieldset className="grid gap-4 md:grid-cols-2" disabled={pending}>
        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"보유 계좌"}</ManagementText><select
            className={fieldClassName}
            defaultValue=""
            name="accountId"
            required
          >
            <option disabled value=""><ManagementText>{"계좌 선택"}</ManagementText></option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.code})
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"기존 분석 범위"}</ManagementText><select
            aria-describedby="portfolio-group-help"
            className={fieldClassName}
            defaultValue=""
            name="portfolioGroupId"
          >
            <option value=""><ManagementText>{"새 분석 범위 사용"}</ManagementText></option>
            {options.portfolioGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold text-[var(--ink)] md:col-span-2"><ManagementText>{"새 분석 범위 이름"}</ManagementText><ManagementElement as="input"
            aria-describedby="portfolio-group-help"
            className={fieldClassName}
            maxLength={100}
            name="newPortfolioGroupName"
            placeholder="기존 분석 범위를 선택했다면 비워 두세요"
            type="text"
          />
          <span
            className="mt-1 block text-xs font-normal text-[var(--muted)]"
            id="portfolio-group-help"
          ><ManagementText>{"기존 분석 범위 선택 또는 새 범위 이름 중 하나만 사용합니다."}</ManagementText></span>
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"상장 시장"}</ManagementText><select
            className={fieldClassName}
            name="market"
            onChange={(event) => setMarket(event.target.value)}
            value={market}
          >
            {HOLDING_ONBOARDING_MARKETS.map((item) => (
              <option key={item.value} value={item.value}>
                <ManagementText>{item.label}</ManagementText> ({item.currency})
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"종목 유형"}</ManagementText><select className={fieldClassName} defaultValue="etf" name="assetType">
            {HOLDING_ONBOARDING_ASSET_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                <ManagementText>{item.label}</ManagementText>
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"티커"}</ManagementText><ManagementElement as="input"
            autoCapitalize="characters"
            className={fieldClassName}
            maxLength={50}
            name="ticker"
            placeholder={market === "korea" ? "069500" : "VOO"}
            required
            type="text"
          />
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"종목명 (선택)"}</ManagementText><ManagementElement as="input"
            className={fieldClassName}
            maxLength={255}
            name="name"
            placeholder="비우면 등록된 종목명 또는 티커 사용"
            type="text"
          />
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"보유 수량"}</ManagementText><input
            className={fieldClassName}
            inputMode="decimal"
            min="0.000001"
            name="quantity"
            required
            step="0.000001"
            type="number"
          />
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"1좌당 매입 원가 ("}</ManagementText>{currency})
          <input
            aria-describedby="average-cost-help"
            className={fieldClassName}
            inputMode="decimal"
            min="0.0001"
            name="averageCost"
            required
            step="0.0001"
            type="number"
          />
          <span
            className="mt-1 block text-xs font-normal text-[var(--muted)]"
            id="average-cost-help"
          ><ManagementText>{"손익 계산의 기준 원가입니다."}</ManagementText></span>
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"현재 1좌 가격 ("}</ManagementText>{currency}<ManagementText>{", 선택)"}</ManagementText><input
            aria-describedby="current-price-help"
            className={fieldClassName}
            inputMode="decimal"
            min="0.0001"
            name="currentPrice"
            step="0.0001"
            type="number"
          />
          <span
            className="mt-1 block text-xs font-normal text-[var(--muted)]"
            id="current-price-help"
          ><ManagementText>{"비우면 최신 저장 가격을 사용합니다."}</ManagementText></span>
        </label>

        <label className="text-sm font-semibold text-[var(--ink)]"><ManagementText>{"증권사 표시 수익률 (%, 선택)"}</ManagementText><input
            aria-describedby="reported-return-help"
            className={fieldClassName}
            inputMode="decimal"
            min="-99.999999"
            name="reportedReturnPct"
            step="0.000001"
            type="number"
          />
          <span
            className="mt-1 block text-xs font-normal text-[var(--muted)]"
            id="reported-return-help"
          ><ManagementText>{"검산용으로만 보존하며 손익 계산에는 사용하지 않습니다."}</ManagementText></span>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-5">
        <button
          className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending || options.accounts.length === 0}
          type="submit"
        >
          <ManagementText>{pending ? "저장 중" : "보유종목 저장"}</ManagementText>
        </button>
        <Link
          className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
          href="/portfolio/holdings?account=all"
        ><ManagementText>{"취소"}</ManagementText></Link>
        <p
          aria-live="polite"
          className={[
            "text-sm",
            state.status === "success" ? "text-[var(--brand)]" : "text-[var(--warning)]",
          ].join(" ")}
        >
          <ManagementText>{state.message}</ManagementText>
        </p>
      </div>
    </form>
  );
}

const fieldClassName =
  "mt-1.5 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm font-normal text-[var(--ink)] outline-none focus:border-[var(--ink)] disabled:bg-[var(--wash)]";
