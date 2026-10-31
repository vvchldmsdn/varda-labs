import { LabText } from "./lab-text";
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
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput } from "@/components/cairn-ui";


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
        <div className="grid gap-5">
          <div className="min-w-0">
            <p className="text-sm text-[var(--muted)]"><LabText value="같은 기간과 투자금으로 비교해요." /></p>
            {period.availableStartServiceDate &&
            period.availableEndServiceDate ? (
              <p className="mt-2 text-sm tabular-nums text-[var(--muted)]"><LabText value=" 선택 가능 " />{formatDate(period.availableStartServiceDate)} ~{" "}
                {formatDate(period.availableEndServiceDate)}
              </p>
            ) : null}
          </div>

          <CairnForm
            id="investment-lab-period-filter"
            action="/investment-lab"
            className="flex flex-wrap items-end gap-4"
            key={[
              scopeKey,
              period.status,
              period.requestedStartServiceDate,
              period.requestedEndServiceDate,
              period.selectedStartServiceDate,
              period.selectedEndServiceDate,
            ].join(":")}
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
            <div className="flex flex-wrap items-center gap-4">
              <CairnButton variant="primary"
                type="submit"
              ><LabText value="기간 적용" /></CairnButton>
              <InvestmentLabQueryLink
                resetForm
                className="inline-flex min-h-12 items-center px-2 text-sm text-[var(--muted)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
                href={buildPortfolioAnalysisScopeHref(
                  "/investment-lab",
                  scopeKey,
                  {
                    kodexWeight: query.kodexWeight,
                    basketAnchor: query.basketAnchor,
                  },
                )}
              ><LabText value=" 최신 구간 " /></InvestmentLabQueryLink>
            </div>
          </CairnForm>
        </div>

        {period.status === "invalid" || period.status === "unavailable" ? (
          <p
            className="mt-4 border-t border-[var(--brand-soft)] pt-3 text-sm text-[var(--warning)]"
            data-period-reason={period.reason}
          >
            <LabText value={periodReasonLabel(period.reason)} />
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
    <CairnField className="min-w-0 flex-1 basis-48">
      <LabText value={label} />
      <CairnInput
        style={{ minHeight: 48 }}
        defaultValue={defaultValue ?? ""}
        max={max ?? undefined}
        min={min ?? undefined}
        name={name}
        required
        type="date"
      />
    </CairnField>
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
