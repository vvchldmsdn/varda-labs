export type InvestmentLabScenarioDiagnosis = Readonly<{
  reason: string;
  resolution: string;
}>;

export function diagnoseInvestmentLabScenario(
  reasonCodes: readonly string[],
): InvestmentLabScenarioDiagnosis {
  if (reasonCodes.includes("approved_target_policy_missing")) {
    return diagnosis(
      "이 범위에 승인된 목표 비중이 없습니다.",
      "목표비중 화면에서 현재 보유 종목 전체의 비중을 저장하고 승인하면 다음 조회부터 계산됩니다.",
    );
  }
  if (reasonCodes.includes("approved_target_policy_conflict")) {
    return diagnosis(
      "동시에 유효한 승인 목표 비중이 둘 이상입니다.",
      "중복 revision을 철회하거나 supersede하여 현재 승인본을 하나로 확정해야 합니다.",
    );
  }
  if (reasonCodes.includes("target_policy_not_effective")) {
    return diagnosis(
      "분석 시작일에 목표 비중 정책이 아직 효력을 갖지 않았습니다.",
      "정책 효력일 이후 구간을 선택하거나, 더 이른 효력일의 정책을 별도로 검토·승인해야 합니다.",
    );
  }
  if (
    includesAny(reasonCodes, [
      "target_policy_universe_mismatch",
      "target_policy_vector_mismatch",
      "target_weight_vector_mismatch",
    ])
  ) {
    return diagnosis(
      "현재 보유 종목 집합과 승인 목표 비중 벡터가 일치하지 않습니다.",
      "추가·삭제된 종목과 명시적 0% 행까지 반영해 목표 벡터를 새 revision으로 다시 승인해야 합니다.",
    );
  }
  if (reasonCodes.includes("named_account_target_policy_unavailable")) {
    return diagnosis(
      "전체 범위에 포함된 일부 계정의 승인 목표 비중이 없습니다.",
      "누락된 각 계정의 목표 비중을 승인하거나, 계산할 계정 범위를 좁혀야 합니다.",
    );
  }
  if (reasonCodes.includes("period_mismatch")) {
    return diagnosis(
      "시나리오들의 시작일·종료일·평가일 축이 서로 다릅니다.",
      "누락 가격·환율을 보완한 뒤 동일한 공통 비교 구간으로 경로를 다시 계산해야 합니다.",
    );
  }
  if (
    includesAny(reasonCodes, [
      "tickerless_anchor_holding",
      "physical_anchor_holding",
      "manual_valuation_history_required",
    ])
  ) {
    return diagnosis(
      "티커가 없는 수동 평가 자산의 기간별 가격 근거가 부족합니다.",
      "날짜별 수동 평가 이력을 입력하거나 검증된 별도 가격 공급자를 연결해야 합니다. 저장가 이월을 시장 수익률로 간주하지는 않습니다.",
    );
  }
  if (reasonCodes.some((reason) => reason.includes("price"))) {
    return diagnosis(
      "필요한 종가가 누락됐거나 같은 종목·날짜의 근거가 충돌합니다.",
      "표시된 종목과 기간만 provider로 보완하고, 중복 행은 출처 우선순위에 따라 하나로 확정해야 합니다.",
    );
  }
  if (reasonCodes.some((reason) => reason.includes("fx"))) {
    return diagnosis(
      "USD 자산 평가에 필요한 날짜별 USD/KRW 근거가 없거나 충돌합니다.",
      "해당 날짜의 환율만 보완하고, 같은 날짜의 비표본 기준 환율을 하나로 확정해야 합니다.",
    );
  }
  if (
    includesAny(reasonCodes, [
      "base_period_unavailable",
      "base_path_unavailable",
      "actual_path_incomplete",
      "actual_path_reconciliation_mismatch",
      "snapshot_evidence_invalid",
    ])
  ) {
    return diagnosis(
      "실제 포트폴리오의 공통 비교 경로가 완성되지 않았습니다.",
      "누락·중복 스냅샷과 거래 흐름을 먼저 감사한 뒤 실제 경로를 복구해야 합니다. 다른 시나리오 값으로 대신 채우지는 않습니다.",
    );
  }
  if (reasonCodes.includes("insufficient_common_preperiod_rows")) {
    return diagnosis(
      "분석 시작 전 공동 일간수익률이 60개 미만입니다.",
      "더 이른 종가·환율을 보완하거나 사용자가 명시적으로 더 짧은 학습 구간을 선택해야 합니다.",
    );
  }
  if (reasonCodes.includes("insufficient_periods")) {
    return diagnosis(
      "현금흐름 조정 수익률과 위험 지표를 만들 공통 평가 구간이 없습니다.",
      "실제 경로와 시나리오 경로의 공통 평가일을 2일 이상 확보하고, 해당 구간의 거래 흐름·종가·환율 누락을 보완해야 합니다.",
    );
  }
  if (reasonCodes.includes("insufficient_volatility_periods")) {
    return diagnosis(
      "최대 낙폭은 계산할 수 있지만 연환산 변동성에 필요한 연속 일간수익률이 20개 미만입니다.",
      "조회 구간을 늘리거나 누락된 종가·환율을 보완해 20개 이상의 연속 일간수익률을 확보해야 합니다.",
    );
  }
  if (reasonCodes.includes("irregular_volatility_axis")) {
    return diagnosis(
      "수익률 관측일 사이가 하루보다 길어 일간 변동성으로 연환산할 수 없습니다.",
      "빠진 날짜의 종가·환율을 보완해 연속 일간 축을 만들고 다시 계산해야 합니다.",
    );
  }
  if (
    includesAny(reasonCodes, [
      "anchor_selection_unavailable",
      "target_anchor_unavailable",
      "invalid_anchor_allocation",
      "no_listed_rebalance_sleeve",
    ])
  ) {
    return diagnosis(
      "비교 시작일의 보유 구성 또는 배분 기준을 확정할 수 없습니다.",
      "시작일 포지션 스냅샷과 종목 식별을 보완한 뒤 기준 바스켓을 다시 선택해야 합니다.",
    );
  }
  if (
    includesAny(reasonCodes, [
      "account_composition_incomplete",
      "account_composition_mismatch",
      "component_axis_mismatch",
    ])
  ) {
    return diagnosis(
      "포함 계정 또는 종목 구성의 합계가 전체 경로와 일치하지 않습니다.",
      "계정 소유권·그룹 멤버십·종목 축을 같은 기준일로 다시 감사해야 합니다.",
    );
  }
  if (
    includesAny(reasonCodes, [
      "event_account_unresolved",
      "event_evidence_unsupported",
      "flow_evidence_mismatch",
      "flow_schedule_blocked",
    ])
  ) {
    return diagnosis(
      "매수·매도·입출금 흐름의 계정 또는 금액 근거가 완전하지 않습니다.",
      "이벤트의 계정·종목 연결과 원화 금액을 보완한 뒤 동일 흐름 일정을 다시 생성해야 합니다.",
    );
  }

  return diagnosis(
    "필요한 계산 근거 중 하나 이상이 아직 완전하지 않습니다.",
    "상세 근거 코드와 데이터 준비 상태에서 막힌 가격·환율·스냅샷·정책 항목을 먼저 보완해야 합니다.",
  );
}

function diagnosis(reason: string, resolution: string) {
  return Object.freeze({ reason, resolution });
}

function includesAny(values: readonly string[], candidates: readonly string[]) {
  return candidates.some((candidate) => values.includes(candidate));
}
