import Link from "next/link";

import type {
  InvestmentLabPeriodSelection,
  InvestmentLabPeriodSelectionReason,
} from "@/lib/investment-lab-period-selection";
import {
  buildPortfolioAccountScopeHref,
  type PortfolioAccountScope,
  type PortfolioAccountScopeQuery,
} from "@/lib/portfolio-account-scope";

export function InvestmentLabPeriodSelector({
  account,
  period,
  query,
}: {
  account: PortfolioAccountScope;
  period: InvestmentLabPeriodSelection;
  query: PortfolioAccountScopeQuery;
}) {
  return (
    <section
      className="border-y border-[#dfe3d5] bg-[#f8faf5] px-4 py-4"
      data-period-status={period.status}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold">과거 비교 구간</h2>
          <p className="mt-1 text-sm text-[#687064]">
            저장된 관측일 두 개를 선택하면 시작 평가액과 구간 내 거래를 기준으로
            실제·KODEX 200·VOO 경로를 다시 계산합니다.
          </p>
          {period.availableStartServiceDate &&
          period.availableEndServiceDate ? (
            <p className="mt-1 text-xs text-[#777e73]">
              선택 가능 {formatDate(period.availableStartServiceDate)} ~{" "}
              {formatDate(period.availableEndServiceDate)}
            </p>
          ) : null}
        </div>

        <form
          action="/investment-lab"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          method="get"
        >
          <input name="account" type="hidden" value={account} />
          <PreservedHiddenInputs query={query} />
          <DateField
            defaultValue={period.requestedStartServiceDate}
            label="시작 관측일"
            max={period.availableEndServiceDate}
            min={period.availableStartServiceDate}
            name="start"
          />
          <DateField
            defaultValue={period.requestedEndServiceDate}
            label="종료 관측일"
            max={period.availableEndServiceDate}
            min={period.availableStartServiceDate}
            name="end"
          />
          <div className="flex gap-2">
            <button
              className="h-10 rounded-md bg-[#183f38] px-4 text-sm font-semibold text-white hover:bg-[#12332d]"
              type="submit"
            >
              구간 적용
            </button>
            <Link
              className="flex h-10 items-center rounded-md border border-[#d4dbce] bg-white px-4 text-sm font-semibold text-[#394138] hover:bg-[#edf1e8]"
              href={buildPortfolioAccountScopeHref(
                "/investment-lab",
                account,
                {
                  kodexWeight: query.kodexWeight,
                  basketAnchor: query.basketAnchor,
                },
              )}
            >
              최신 구간
            </Link>
          </div>
        </form>
      </div>

      {period.status === "invalid" || period.status === "unavailable" ? (
        <p
          className="mt-3 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-3 py-2 text-sm text-[#725f2d]"
          data-period-reason={period.reason}
        >
          {periodReasonLabel(period.reason)}
        </p>
      ) : period.status === "current_writer" ? (
        <p className="mt-3 text-sm font-medium text-[#356555]">
          최신 writer 구간 {formatDate(period.selectedStartServiceDate!)} ~{" "}
          {formatDate(period.selectedEndServiceDate!)}를 자동 적용했습니다.
        </p>
      ) : period.status === "selected" ? (
        <p className="mt-3 text-sm font-medium text-[#356555]">
          선택 구간 {formatDate(period.selectedStartServiceDate!)} ~{" "}
          {formatDate(period.selectedEndServiceDate!)}를 다시 계산했습니다.
        </p>
      ) : null}
    </section>
  );
}

function PreservedHiddenInputs({ query }: { query: PortfolioAccountScopeQuery }) {
  return Object.entries(query).flatMap(([name, value]) => {
    if (
      name === "account" ||
      name === "start" ||
      name === "end" ||
      value === null ||
      value === undefined
    ) {
      return [];
    }
    const values = Array.isArray(value) ? value : [value];
    return values.map((item, index) => (
      <input
        key={`${name}:${index}`}
        name={name}
        type="hidden"
        value={item}
      />
    ));
  });
}

function DateField({
  defaultValue,
  label,
  max,
  min,
  name,
}: {
  defaultValue: string | null;
  label: string;
  max: string | null;
  min: string | null;
  name: "start" | "end";
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-[#5d665b]">
      {label}
      <input
        className="h-10 min-w-[160px] rounded-md border border-[#d4dbce] bg-white px-3 text-sm font-normal text-[#171916]"
        defaultValue={defaultValue ?? ""}
        max={max ?? undefined}
        min={min ?? undefined}
        name={name}
        required
        type="date"
      />
    </label>
  );
}

function periodReasonLabel(reason: InvestmentLabPeriodSelectionReason | null) {
  const labels: Record<InvestmentLabPeriodSelectionReason, string> = {
    ambiguous_query: "시작일과 종료일은 각각 하나만 지정해야 합니다.",
    both_dates_required: "시작 관측일과 종료 관측일을 모두 선택해 주세요.",
    invalid_date: "날짜 형식이 올바르지 않습니다.",
    invalid_order: "종료 관측일은 시작 관측일보다 뒤여야 합니다.",
    source_unavailable: "선택 가능한 전체 관측 구간을 확인할 수 없습니다.",
    start_not_observed:
      "시작일은 저장된 전체 계정 평가 관측일과 정확히 일치해야 합니다.",
    end_not_observed:
      "종료일은 저장된 전체 계정 평가 관측일과 정확히 일치해야 합니다.",
    range_evidence_incomplete:
      "선택 구간의 실제 평가액·거래·KODEX 200·VOO 가격 또는 환율 근거가 완전하지 않아 일부 결과 대신 구간 전체를 표시하지 않습니다.",
  };
  return reason ? labels[reason] : "선택 구간을 확인해 주세요.";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
