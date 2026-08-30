import { InvestmentLabDialog } from "./investment-lab-dialog";
import {
  InvestmentLabQueryFields,
  InvestmentLabQueryLink,
} from "./investment-lab-query-controls";

import type {
  InvestmentLabPeriodSelection,
  InvestmentLabPeriodSelectionReason,
} from "@/lib/investment-lab-period-selection";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScopeKey,
  type PortfolioAnalysisScopeQuery,
} from "@/lib/portfolio-analysis-scope";

export function InvestmentLabPeriodSelector({
  period,
  query,
  scopeKey,
}: {
  period: InvestmentLabPeriodSelection;
  query: PortfolioAnalysisScopeQuery;
  scopeKey: PortfolioAnalysisScopeKey;
}) {
  return (
    <InvestmentLabDialog
      icon="calendar"
      label={
        period.selectedStartServiceDate && period.selectedEndServiceDate
          ? `${formatDate(period.selectedStartServiceDate)} ~ ${formatDate(period.selectedEndServiceDate)}`
          : "기간 선택"
      }
      title="비교 기간"
    >
      <section data-period-status={period.status}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-[var(--muted)]">
              COMPARISON WINDOW
            </p>
            <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
              <h2 className="text-lg font-semibold tracking-normal">
                과거 비교 구간
              </h2>
              <p className="text-xs text-[var(--muted)]">
                실제 포트폴리오와 대안 세계선에 같은 기간·현금흐름을 적용합니다.
              </p>
            </div>
            {period.availableStartServiceDate &&
            period.availableEndServiceDate ? (
              <p className="mt-2 text-[11px] tabular-nums text-[var(--faint)]">
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
            <input name="scope" type="hidden" value={scopeKey} />
            <PreservedHiddenInputs query={query} />
            <InvestmentLabQueryFields />
            <DateField
              defaultValue={
                period.requestedStartServiceDate ??
                period.selectedStartServiceDate
              }
              label="시작 관측일"
              max={period.availableEndServiceDate}
              min={period.availableStartServiceDate}
              name="start"
            />
            <DateField
              defaultValue={
                period.requestedEndServiceDate ?? period.selectedEndServiceDate
              }
              label="종료 관측일"
              max={period.availableEndServiceDate}
              min={period.availableStartServiceDate}
              name="end"
            />
            <div className="flex h-10 items-end gap-5">
              <button
                className="h-9 border-b border-[var(--ink)] px-1 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
                type="submit"
              >
                구간 적용
              </button>
              <InvestmentLabQueryLink
                className="flex h-9 items-center border-b border-transparent px-1 text-sm text-[var(--muted)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
                href={buildPortfolioAnalysisScopeHref(
                  "/investment-lab",
                  scopeKey,
                  {
                    kodexWeight: query.kodexWeight,
                    basketAnchor: query.basketAnchor,
                  },
                )}
              >
                최신 구간
              </InvestmentLabQueryLink>
            </div>
          </form>
        </div>

        {period.status === "invalid" || period.status === "unavailable" ? (
          <p
            className="mt-4 border-t border-[var(--brand-soft)] pt-3 text-sm text-[var(--warning)]"
            data-period-reason={period.reason}
          >
            {periodReasonLabel(period.reason)}
          </p>
        ) : period.status === "current_writer" ? (
          <p className="mt-3 text-sm font-medium text-[var(--brand)]">
            최신 비교 가능 구간 {formatDate(period.selectedStartServiceDate!)} ~{" "}
            {formatDate(period.selectedEndServiceDate!)}를 자동 적용했습니다.
          </p>
        ) : period.status === "selected" ? (
          <p className="mt-3 text-sm font-medium text-[var(--brand)]">
            선택 구간 {formatDate(period.selectedStartServiceDate!)} ~{" "}
            {formatDate(period.selectedEndServiceDate!)}를 다시 계산했습니다.
          </p>
        ) : null}
      </section>
    </InvestmentLabDialog>
  );
}

function PreservedHiddenInputs({
  query,
}: {
  query: PortfolioAnalysisScopeQuery;
}) {
  return Object.entries(query).flatMap(([name, value]) => {
    if (
      name === "account" ||
      name === "scope" ||
      name === "start" ||
      name === "end" ||
      name === "view" ||
      name === "preview" ||
      value === null ||
      value === undefined
    ) {
      return [];
    }
    const values = Array.isArray(value) ? value : [value];
    return values.map((item, index) => (
      <input key={`${name}:${index}`} name={name} type="hidden" value={item} />
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
    <label className="grid gap-1 text-[10px] font-medium uppercase text-[var(--muted)]">
      {label}
      <input
        className="h-9 min-w-[160px] border-0 border-b border-[var(--line)] bg-transparent px-0 text-sm font-normal text-[var(--ink)] outline-none transition-colors focus:border-[var(--ink)]"
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
      "선택 구간을 하나의 계산 경로로 연결할 근거가 부족합니다. 출처별 실제 관측은 아래에 분리해 표시하고, 시나리오 계산은 검증된 최신 구간에서만 제공합니다.",
  };
  return reason ? labels[reason] : "선택 구간을 확인해 주세요.";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
