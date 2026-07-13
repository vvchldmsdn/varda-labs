import type { loadSimulationPeriodPreflight } from "./simulation-period-preflight-loader.ts";
import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";

export const SIMULATION_INPUT_READINESS_POLICY = Object.freeze({
  version: "simulation_input_readiness_v1",
  displayMode: "independent_single_instrument_market_evidence",
  returnStepCount: 90,
  historyDayCount: 7,
  historyMode: "request_time_recheck_not_persisted_run_history",
  resultStates: Object.freeze(["matrix_ready", "unavailable"] as const),
  runtimeTrustStatus: "not_established",
  executionStatus: "not_executed",
  automaticEndpointRollback: "forbidden",
} as const);

type SimulationPeriodPreflight = Awaited<
  ReturnType<typeof loadSimulationPeriodPreflight>
>;

export type SimulationInputReadinessDescriptor = Readonly<{
  id: "kodex200" | "voo";
  name: string;
  ticker: string;
  market: string;
  marketLabel: string;
  currency: "KRW" | "USD";
  priceBasisLabel: string;
  fxBasisLabel: string;
}>;

export type SimulationInputReadinessModel = ReturnType<
  typeof buildSimulationInputReadiness
>;

export type SimulationEndServiceDateSelection =
  | Readonly<{
      status: "valid";
      source: "server_default" | "query";
      endServiceDate: string;
    }>
  | Readonly<{
      status: "invalid";
      source: "query";
      endServiceDate: "";
    }>;

export type SimulationInputReadinessPageModel = ReturnType<
  typeof buildSimulationInputReadinessPageModel
>;

export function resolveSimulationEndServiceDateSelection(input: {
  suppliedValue: string | string[] | undefined;
  defaultEndServiceDate: string;
}): SimulationEndServiceDateSelection {
  if (input.suppliedValue === undefined) {
    return isRiskDate(input.defaultEndServiceDate)
      ? Object.freeze({
          status: "valid" as const,
          source: "server_default" as const,
          endServiceDate: input.defaultEndServiceDate,
        })
      : Object.freeze({
          status: "invalid" as const,
          source: "query" as const,
          endServiceDate: "" as const,
        });
  }

  if (
    Array.isArray(input.suppliedValue) ||
    !isRiskDate(input.suppliedValue)
  ) {
    return Object.freeze({
      status: "invalid" as const,
      source: "query" as const,
      endServiceDate: "" as const,
    });
  }

  return Object.freeze({
    status: "valid" as const,
    source: "query" as const,
    endServiceDate: input.suppliedValue,
  });
}

export function buildSimulationInputReadinessDates(endServiceDate: string) {
  if (!isRiskDate(endServiceDate)) return Object.freeze([] as string[]);

  return Object.freeze(
    Array.from(
      { length: SIMULATION_INPUT_READINESS_POLICY.historyDayCount },
      (_, index) => shiftRiskDate(endServiceDate, -index),
    ),
  );
}

export function buildSimulationInputReadiness(input: {
  requestedEndServiceDate: string;
  generatedAt: string;
  inputs: readonly Readonly<{
    descriptor: SimulationInputReadinessDescriptor;
    preflight: SimulationPeriodPreflight;
  }>[];
}) {
  const items = input.inputs.map(({ descriptor, preflight }) =>
    projectInputReadiness(descriptor, preflight),
  );
  const readyInputCount = items.filter(
    (item) => item.status === "matrix_ready",
  ).length;

  return Object.freeze({
    policy: SIMULATION_INPUT_READINESS_POLICY,
    requestedEndServiceDate: input.requestedEndServiceDate,
    generatedAt: input.generatedAt,
    runtimeTrustStatus: "not_established" as const,
    executionStatus: "not_executed" as const,
    summary: Object.freeze({
      totalInputCount: items.length,
      readyInputCount,
      unavailableInputCount: items.length - readyInputCount,
      returnStepCount: SIMULATION_INPUT_READINESS_POLICY.returnStepCount,
      requiredPointCount:
        SIMULATION_INPUT_READINESS_POLICY.returnStepCount + 1,
    }),
    inputs: Object.freeze(items),
  });
}

export function buildSimulationInputReadinessPageModel(input: {
  selection: SimulationEndServiceDateSelection;
  selected: SimulationInputReadinessModel;
  history: readonly SimulationInputReadinessModel[];
}) {
  const history = input.history.map((model) =>
    Object.freeze({
      serviceDate: model.requestedEndServiceDate,
      readyInputCount: model.summary.readyInputCount,
      totalInputCount: model.summary.totalInputCount,
      inputs: Object.freeze(
        model.inputs.map((item) =>
          Object.freeze({
            id: item.id,
            ticker: item.ticker,
            status: item.status,
            resolvedPointCount: item.resolvedPointCount,
            requiredPointCount: item.requiredPointCount,
            returnCoverage: item.returnCoverage
              ? Object.freeze({
                  readyReturnCount: item.returnCoverage.readyReturnCount,
                  requiredReturnCount:
                    item.returnCoverage.requiredReturnCount,
                })
              : null,
            issueLabels: Object.freeze(
              item.issues.map((issue) => issue.label),
            ),
          }),
        ),
      ),
    }),
  );

  return Object.freeze({
    ...input.selected,
    endServiceDateSelection: input.selection,
    history: Object.freeze(history),
  });
}

function projectInputReadiness(
  descriptor: SimulationInputReadinessDescriptor,
  preflight: SimulationPeriodPreflight,
) {
  const axisCandidate = preflight.axis.candidates.find(
    (candidate) =>
      candidate.market === descriptor.market &&
      candidate.currency === descriptor.currency &&
      candidate.ticker === descriptor.ticker,
  );
  const matrixInstrument = preflight.matrixEvidence?.instruments.find(
    (instrument) =>
      instrument.market === descriptor.market &&
      instrument.currency === descriptor.currency &&
      instrument.ticker === descriptor.ticker,
  );
  const issues = new Map<string, Readonly<{ code: string; label: string; dates: readonly string[] }>>();

  for (const issue of preflight.axis.issues) {
    addIssue(issues, issue.reason, issue.dates);
  }
  for (const reason of matrixInstrument?.reasons ?? []) {
    addIssue(issues, reason, []);
  }
  for (const blocker of preflight.matrixEvidence?.blockers ?? []) {
    addIssue(issues, blocker.reason, blocker.dates);
  }
  for (const exclusion of preflight.matrixEvidence?.exclusions ?? []) {
    addIssue(issues, exclusion.reason, []);
  }
  if (!axisCandidate) addIssue(issues, "missing_preflight_candidate", []);
  if (preflight.matrixEvidence && !matrixInstrument) {
    addIssue(issues, "missing_matrix_instrument", []);
  }

  const status =
    preflight.status === "matrix_ready" &&
    preflight.matrixStatus === "ready" &&
    axisCandidate?.status === "observed" &&
    matrixInstrument?.status === "ready"
      ? ("matrix_ready" as const)
      : ("unavailable" as const);

  if (status === "unavailable" && issues.size === 0) {
    addIssue(issues, "matrix_not_ready", []);
  }

  const priceCoverage = matrixInstrument
    ? Object.freeze({
        requiredServiceDateCount:
          matrixInstrument.priceCoverage.requiredServiceDateCount,
        coveredServiceDateCount:
          matrixInstrument.priceCoverage.coveredServiceDateCount,
        coveragePct: matrixInstrument.priceCoverage.coveragePct,
        observedSourceDateFrom:
          matrixInstrument.priceCoverage.observedSourceDateFrom,
        observedSourceDateTo:
          matrixInstrument.priceCoverage.observedSourceDateTo,
      })
    : null;
  const fxCoverage =
    matrixInstrument?.fxCoverage.status === "required"
      ? Object.freeze({
          requiredServiceDateCount:
            matrixInstrument.fxCoverage.requiredServiceDateCount,
          coveredServiceDateCount:
            matrixInstrument.fxCoverage.coveredServiceDateCount,
          coveragePct: matrixInstrument.fxCoverage.coveragePct,
          observedSourceDateFrom:
            matrixInstrument.fxCoverage.observedSourceDateFrom,
          observedSourceDateTo:
            matrixInstrument.fxCoverage.observedSourceDateTo,
        })
      : null;

  return Object.freeze({
    ...descriptor,
    status,
    requestedEndServiceDate:
      preflight.axis.endpoint.requestedEndServiceDate ?? null,
    resolvedEndServiceDate:
      preflight.axis.endpoint.resolvedEndServiceDate ?? null,
    nearestPriorObservedServiceDate:
      preflight.axis.endpoint.nearestPriorObservedServiceDate ?? null,
    returnStepCount: preflight.axis.request.returnStepCount,
    requiredPointCount: preflight.axis.request.requiredPointCount,
    resolvedPointCount: preflight.axis.resolvedServiceDates.length,
    observedServiceDateFrom: axisCandidate?.firstServiceDate ?? null,
    observedServiceDateTo: axisCandidate?.lastServiceDate ?? null,
    acceptedPriceObservationCount:
      preflight.axis.axisSources.acceptedPriceObservationCount,
    acceptedFxObservationCount:
      preflight.axis.axisSources.acceptedFxObservationCount,
    priceCoverage,
    fxCoverage,
    returnCoverage: matrixInstrument
      ? Object.freeze({
          requiredReturnCount:
            matrixInstrument.returnCoverage.requiredReturnCount,
          readyReturnCount: matrixInstrument.returnCoverage.readyReturnCount,
          coveragePct: matrixInstrument.returnCoverage.coveragePct,
        })
      : null,
    issues: Object.freeze([...issues.values()]),
  });
}

function addIssue(
  issues: Map<
    string,
    Readonly<{ code: string; label: string; dates: readonly string[] }>
  >,
  code: string,
  dates: readonly string[],
) {
  const safeDates = dates.filter(isDateKey);
  const key = `${code}|${safeDates.join(",")}`;
  if (issues.has(key)) return;
  issues.set(
    key,
    Object.freeze({
      code,
      label: issueLabel(code),
      dates: Object.freeze([...safeDates]),
    }),
  );
}

function issueLabel(code: string) {
  const labels: Record<string, string> = {
    invalid_end_service_date: "검사 기준일 형식이 올바르지 않습니다.",
    invalid_return_step_count: "수익률 관측 수 설정이 올바르지 않습니다.",
    empty_candidate_universe: "검사할 연구 입력이 없습니다.",
    invalid_candidate_identity: "종목 식별 정보가 올바르지 않습니다.",
    unsupported_candidate_currency: "지원하지 않는 통화입니다.",
    duplicate_candidate: "같은 종목 입력이 중복되었습니다.",
    invalid_price_date: "가격 관측 날짜가 올바르지 않습니다.",
    raw_close_field_forbidden: "조정종가가 아닌 가격 필드가 포함되었습니다.",
    invalid_adjusted_close: "조정종가 값이 올바르지 않습니다.",
    duplicate_price_date: "같은 날짜의 가격 행이 중복되었습니다.",
    invalid_fx_date: "환율 관측 날짜가 올바르지 않습니다.",
    invalid_fx_status: "사용할 수 없는 환율 상태입니다.",
    invalid_fx_rate: "환율 값이 올바르지 않습니다.",
    duplicate_fx_date: "같은 날짜의 환율 행이 중복되었습니다.",
    end_service_date_not_observed: "요청한 기준일의 시장 관측값이 없습니다.",
    insufficient_axis_points: "필요한 관측 기간이 부족합니다.",
    missing_candidate_price: "종목 가격 이력을 찾지 못했습니다.",
    missing_fx_observation: "USD/KRW 환율 이력을 찾지 못했습니다.",
    insufficient_service_dates: "수익률 계산에 필요한 기준일 수가 부족합니다.",
    invalid_service_date: "기준일 값이 올바르지 않습니다.",
    duplicate_service_date: "기준일이 중복되었습니다.",
    unsorted_service_dates: "기준일 순서가 올바르지 않습니다.",
    duplicate_instrument: "연구 입력 종목이 중복되었습니다.",
    invalid_instrument_history_status: "종목 이력 상태가 올바르지 않습니다.",
    invalid_price_identity: "가격 행의 종목 식별 정보가 일치하지 않습니다.",
    invalid_return_value: "수익률 계산 결과가 유효하지 않습니다.",
    missing_price: "일부 기준일의 가격 증거가 없습니다.",
    stale_price: "일부 가격 증거가 허용 기간보다 오래되었습니다.",
    missing_fx: "일부 기준일의 환율 증거가 없습니다.",
    stale_fx: "일부 환율 증거가 허용 기간보다 오래되었습니다.",
    instrument_history_unavailable: "종목별 가격 이력을 사용할 수 없습니다.",
    invalid_market: "시장 식별 정보가 올바르지 않습니다.",
    missing_ticker: "종목 코드가 없습니다.",
    unsupported_currency: "지원하지 않는 통화입니다.",
    missing_preflight_candidate: "검사 대상 종목의 축 증거가 없습니다.",
    missing_matrix_instrument: "검사 대상 종목의 행렬 증거가 없습니다.",
    matrix_not_ready: "수익률 행렬 준비 조건을 충족하지 못했습니다.",
  };
  return labels[code] ?? "확인되지 않은 데이터 결손이 있습니다.";
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
