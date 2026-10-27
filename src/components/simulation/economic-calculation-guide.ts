import type { CalculationGuideDefinition } from "@/components/explanations/calculation-guide-types";

// Display-only companion to the economic-state simulation. It does not load
// market data, fit a model, choose weights, or place orders.
export const economicCalculationGuide = {
  id: "simulation-economic-state",
  methodTopic: "economic-simulation",
  intro: {
    ko: "지금의 환율·미국 금리 상태와 종목별 실제 움직임을 함께 읽고, 여러 가능한 흐름 안에서 현재 구성과 작은 비중 변경을 비교합니다. 이 모형 안에서의 비교이며 미래를 맞힌다는 뜻은 아닙니다.",
    en: "Read the current FX and US rate environment alongside actual asset movements, then compare today's allocation with small weight changes across possible paths. This is a comparison within a model, not a claim to predict the future.",
  },
  steps: [
    {
      id: "evidence",
      label: { ko: "같은 날짜의 자료", en: "Aligned evidence" },
      title: { ko: "내 종목과 경제 자료를 같은 날짜에 맞춰요", en: "Align your assets with economic observations" },
      body: {
        ko: "계산에 포함된 종목들의 최근 90개 공통 원화 수익률 구간에서 시작합니다. 여기에 달러/원 환율, 미국 10년 국채금리, 미국 10년−2년 금리차 자료가 함께 맞는 구간이 최소 45개 있어야 합니다.",
        en: "Start with the latest 90 common KRW-return intervals for included holdings. At least 45 intervals must also match USD/KRW, the US 10-year Treasury yield, and the US 10-year minus 2-year yield spread.",
      },
      nodes: [
        { label: { ko: "내 종목의 원화 변화", en: "Your assets' KRW returns" }, detail: { ko: "현재 보유 구성 · 공통 가격 이력", en: "Current composition · shared price history" } },
        { label: { ko: "환율·금리·금리차", en: "FX · yield · yield spread" }, detail: { ko: "날짜가 맞는 저장 근거", en: "Stored evidence matched by date" } },
        { label: { ko: "함께 준비된 구간", en: "Jointly available intervals" }, detail: { ko: "최소 45개", en: "At least 45" } },
      ],
      takeAway: {
        ko: "매입원가가 없어도 가격 이력은 사용할 수 있지만, 빠진 시장 자료를 0이나 임의 평균으로 채우지는 않습니다.",
        en: "Price history can be used without an acquisition cost. Missing market evidence is never filled with zero or an invented average.",
      },
      detail: {
        ko: "달러 자산도 먼저 날짜별 환율을 반영한 원화 수익률로 바꾸므로 환율을 뒤에서 한 번 더 곱하지 않습니다. 각 경제 상태는 기준일 이전에 공개된 저장 자료만 사용하며 공표일·관측일·관측기간 말일 중 가장 오래된 날짜로 7일 이내인지 확인합니다. 종목 학습 이력의 끝과 경제 상태의 기준일은 다를 수 있습니다. 모든 나라의 기준금리·뉴스·정책·산업 전망을 읽는 모형은 아닙니다.",
        en: "USD assets first become KRW returns using date-aligned FX, so FX is not multiplied in again. Each economic state uses stored releases strictly before its date and checks a seven-day age limit against the oldest of release, factor and period-end dates. The asset-history endpoint and economic-state date may differ. The model does not read every country's policy rates, news, policies or industry outlooks.",
      },
    },
    {
      id: "state-and-paths",
      label: { ko: "가능한 흐름", en: "Possible paths" },
      title: { ko: "지금과 비슷한 상태를 참고해 흐름을 만들어요", en: "Use similar states to inform possible movements" },
      body: {
        ko: "환율·금리 수준이 비슷했던 관측에 더 무게를 주어 다음 움직임의 평균을 조정합니다. 비슷한 자료가 적거나 현재 상태가 과거에서 너무 멀면 조정은 약해집니다. 조정 비중은 최대 절반이며, 나머지는 전체 관측의 평균을 남깁니다.",
        en: "Give more weight to observations with similar FX and rate levels when adjusting the mean next movement. The adjustment fades when similar evidence is sparse or the state is far from history. Its blend is capped at one half, retaining the broader historical mean.",
      },
      nodes: [
        { label: { ko: "비슷한 경제 상태", en: "Similar economic states" } },
        { label: { ko: "공통 충격 + 종목별 차이", en: "Shared shocks + asset differences" } },
        { label: { ko: "1,000개 가능한 흐름", en: "1,000 possible paths" }, detail: { ko: "메인 차트에 전체 표시", en: "All displayed on the main chart" } },
      ],
      takeAway: {
        ko: "평균 방향과 흔들림은 다릅니다. 비슷한 과거가 있다고 미래가 같은 방향으로 움직이도록 고정하지 않습니다.",
        en: "The mean direction is separate from uncertainty. Similar history does not lock future movements to the same direction.",
      },
      detail: {
        ko: "최근 관측을 더 반영한 공분산으로 환율·금리의 동반 움직임을 학습하고 큰 충격도 나올 수 있는 Student-t 분포를 사용합니다. 민감도·공분산은 고정하고 각 경로의 누적 경제 상태에 따라 다음 변화의 평균만 매 단계 다시 구합니다. 각 종목에는 요인으로 설명하지 못한 상관된 잔차 움직임도 더합니다. 기존 과거 구간 재표본 추출과는 별도 모형입니다.",
        en: "A recency-weighted covariance captures joint factor movements, with Student-t shocks allowing heavier tails. Sensitivities and covariances stay fixed; only the mean next change is recalculated each step from the path's accumulated economic state. Correlated residual movements add what factors do not explain. This is separate from the existing historical-block resampling model.",
      },
    },
    {
      id: "allocation-comparison",
      label: { ko: "비중 비교", en: "Compare weights" },
      title: { ko: "같은 흐름에서 비중만 조금씩 바꿔 봐요", en: "Compare small weight changes on the same paths" },
      body: {
        ko: "각 종목에 만들어진 동일한 경로를 현재 비중과 여러 후보 비중에 적용합니다. 중간에 계속 사고팔지 않고 처음 구성으로 보유한다고 가정합니다. 마지막 평가액의 중간값, 하위 10% 경계, 두 기준의 균형을 각각 살펴봅니다.",
        en: "Apply the same simulated asset paths to current weights and candidate weights. Assume buy and hold from each starting allocation, without ongoing rebalancing. Compare terminal median value, the lower 10th-percentile boundary, and a balance of those two criteria.",
      },
      nodes: [
        { label: { ko: "같은 종목 경로", en: "Same asset paths" } },
        { label: { ko: "제한 안의 비중 후보", en: "Constrained candidate weights" } },
        { label: { ko: "중간값·하방·균형", en: "Median · downside · balance" } },
      ],
      takeAway: {
        ko: "좋아 보이는 후보라도 새 종목을 추천하거나 실제 주문으로 연결하지 않습니다.",
        en: "An apparently better candidate neither recommends new instruments nor becomes an actual order.",
      },
      detail: {
        ko: "일방향 비중 이동량은 최대 20%, 비원화 표시 자산 비중 변화는 최대 10%포인트로 제한합니다. 종목 비중 상한은 35%와 기존 구성의 최대 종목 비중 중 큰 값입니다. 균형 기준은 P50과 P10의 평균입니다. 후보 차트에는 표본선 12개를 보여주지만 지표는 전체 1,000개 경로로 계산합니다. P10은 모형 경로의 하위 경계이지 손실의 최저 한도나 안전 보장이 아닙니다.",
        en: "One-way turnover is capped at 20%, and the change in non-KRW-denominated weight at 10 percentage points. The position-weight ceiling is the greater of 35% and the largest current position weight. The balanced objective averages P50 and P10. Candidate charts show 12 sample lines, while metrics use all 1,000 paths. P10 is a lower boundary within model paths, not a maximum possible loss or a safety guarantee.",
      },
    },
    {
      id: "checks",
      label: { ko: "검증과 해석", en: "Checks and interpretation" },
      title: { ko: "후보를 찾은 자료와 확인할 자료를 나눠요", en: "Separate candidate selection from confirmation" },
      body: {
        ko: "1,000개 모형 경로를 짝수·홀수 500개씩 나눕니다. 한쪽에서 후보를 찾고 다른 쪽에서도 현재보다 목적 점수가 개선될 때만 보여줍니다. 이 확인도 같은 학습 모형 안의 검사입니다. 실제 미래를 미리 맞혔다는 증거와 구분해야 합니다.",
        en: "Split the 1,000 model paths into even and odd sets of 500. Select a candidate on one set and show it only if its objective also improves on current weights in the other. Both sets come from the same fitted model, so this is distinct from evidence of predicting actual future outcomes.",
      },
      nodes: [
        { label: { ko: "500개로 후보 탐색", en: "Select on 500 paths" } },
        { label: { ko: "다른 500개로 확인", en: "Confirm on another 500" } },
        { label: { ko: "별도의 시간순 점검", en: "Separate chronological check" }, detail: { ko: "학습 90개 → 이후 21개", en: "Train on 90 → inspect the next 21" } },
      ],
      takeAway: {
        ko: "경로를 나눈 확인, 과거 시간순 점검, 아직 오지 않은 실제 미래는 서로 다릅니다.",
        en: "A path-split check, a chronological historical check, and an unseen real future are different things.",
      },
      detail: {
        ko: "시간순 점검은 각 과거 기준점까지의 90개 구간으로 학습하고 그 뒤 21개 구간과 비교합니다. 필요한 자료가 없으면 결과를 비워 둡니다. 당시 공표본·수정 전 데이터가 보존되었다는 보장은 없으므로 완전한 시점 일치 백테스트라고 부르지 않습니다. 지금의 종목 구성을 과거에 적용하며 당시 내 실제 매매 성과를 재현하는 것도 아닙니다.",
        en: "A chronological check fits each past window of 90 intervals and compares against the next 21. Results remain unavailable when evidence is insufficient. Historical release vintages and unrevised data are not guaranteed, so this is not a fully point-in-time backtest. It applies today's instrument set to history rather than reconstructing your actual past trading performance.",
      },
    },
  ],
  notes: [
    {
      title: { ko: "P50은 가장 가능성 높은 미래인가요?", en: "Is P50 the most likely future?" },
      body: { ko: "아니요. 경로 값을 크기순으로 놓았을 때 중간에 있는 값입니다. 하나의 대표 미래나 평균값이 아닙니다. P10·P90도 모형 안의 경계입니다.", en: "No. It is the middle value after sorting the paths, not a single representative future or the arithmetic average. P10 and P90 are boundaries within the model too." },
    },
    {
      title: { ko: "경제 상황을 전부 반영하나요?", en: "Does this capture the whole economy?" },
      body: { ko: "아니요. 연결된 상태 변수는 USD/KRW, 미국 10년 금리, 미국 10년−2년 금리차입니다. 실제 주가 움직임은 학습하지만 각국 정책금리, 기업 실적, 뉴스, 전쟁과 같은 사건을 직접 해석하지 않습니다.", en: "No. Connected state variables are USD/KRW, the US 10-year yield and the US 10-year minus 2-year spread. The model learns from actual asset movements but does not directly interpret all countries' policy rates, earnings, news, wars or other events." },
    },
    {
      title: { ko: "결과가 안정적이면 믿고 투자해도 되나요?", en: "Does a stable result make it safe to invest?" },
      body: { ko: "모형 안에서 반복 확인된다는 뜻일 뿐입니다. 짧은 이력, 자료 수정, 시장 구조 변화, 놓친 요인이 결과를 바꿀 수 있습니다. 후보 비교는 선택을 이해하기 위한 연구 정보입니다.", en: "It means the result survives checks within the model. Short history, data revisions, structural market changes and omitted factors can alter outcomes. Candidate comparisons are research information for understanding choices." },
    },
  ],
  footnote: {
    ko: "실제 주문·목표비중 저장은 하지 않습니다. 수수료·세금·현금수익·중간 입출금은 경로에 포함하지 않습니다.",
    en: "No orders are placed or target weights saved. Paths exclude fees, taxes, cash returns and intermediate deposits or withdrawals.",
  },
} as const satisfies CalculationGuideDefinition;
