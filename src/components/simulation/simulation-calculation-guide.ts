import type { CalculationGuideDefinition } from "@/components/explanations/calculation-guide-types";

/** Describes the connected owner stationary-bootstrap engine; this copy does not calculate returns. */
export const simulationCalculationGuide = {
  id: "simulation-current-holdings",
  methodTopic: "simulation",
  intro: {
    ko: "지금 가진 종목에 과거와 비슷한 움직임이 다시 나타난다면, 어떤 흐름이 가능할지 살펴봅니다.",
    en: "Explore what could happen if movements like those in the past occurred again for your current holdings.",
  },
  steps: [
    {
      id: "holdings", label: { ko: "내 자산", en: "Your holdings" },
      title: { ko: "지금 가진 종목에서 시작해요", en: "Start with what you hold today" },
      body: {
        ko: "선택한 계좌·그룹의 현재 평가액으로 종목별 출발 비중을 정합니다. 계산할 수 있는 종목들의 비중을 합쳐 100%로 맞춥니다.",
        en: "Current values in your selected account or group determine each holding’s starting share. The holdings included in the calculation are scaled to a total of 100%.",
      },
      nodes: [
        { label: { ko: "선택한 내 자산", en: "Selected holdings" } },
        { label: { ko: "현재 금액의 비율", en: "Share of current value" } },
        { label: { ko: "계산에 쓸 구성", en: "Starting composition" } },
      ],
      takeAway: { ko: "목표비중이나 과거에 실제로 보유했던 구성을 쓰는 것이 아닙니다.", en: "This uses today’s holdings, not target weights or the holdings you actually owned in the past." },
      detail: {
        ko: "금현물처럼 필요한 가격 이력이 없는 수동 평가 자산은 별도로 제외 비중을 보여줍니다. 계산 대상 상장종목의 이력이 부족하면 결과를 만들지 않습니다. 빠진 값을 0이나 평균값으로 채우지 않습니다.",
        en: "Excluded weight is shown separately for manually valued assets, such as physical gold without the required history. If an included listed holding lacks history, the calculation stops. Missing values are never filled with zero or an average.",
      },
    },
    {
      id: "history", label: { ko: "과거 변화", en: "Past movements" },
      title: { ko: "하루 동안 얼마나 변했는지 읽어요", en: "Read how values changed each day" },
      body: {
        ko: "저장된 가격과 그 날짜의 환율로 원화 기준 하루 변화를 구합니다. 모든 계산 종목이 함께 준비된 최근 90개 관측 구간을 사용합니다.",
        en: "Stored prices and exchange rates for each date give daily changes in KRW. The calculation uses the latest 90 observation intervals available for all included holdings together.",
      },
      nodes: [
        { label: { ko: "가격·당일 환율", en: "Price + dated FX" } },
        { label: { ko: "하루의 원화 변화", en: "Daily change in KRW" } },
        { label: { ko: "최근 90개 구간", en: "Latest 90 intervals" } },
      ],
      takeAway: { ko: "같은 날의 종목별 움직임을 함께 묶어, 함께 오르고 내린 관계를 남겨둡니다.", en: "Holdings’ movements on the same date stay together, preserving how they moved with one another." },
      detail: {
        ko: "내 포트폴리오의 연결된 계산은 저장된 KIS 미조정 종가와 날짜별 환율을 사용합니다. 배당·액면분할까지 반영한 총수익률이 아닙니다. 시장별 날짜를 맞출 때에는 가격은 최대 7일, 환율은 최대 3일 전의 저장 근거까지 허용합니다. 기준일을 직접 고르면 그 날짜를 적용하며, 자동 선택은 저장 이력의 최신 공통일을 사용합니다.",
        en: "The connected calculation for your portfolio uses stored unadjusted KIS closes and date-specific FX, not total returns adjusted for dividends or stock splits. When aligning markets, stored prices may be carried forward by at most seven days and FX by three days. A selected date is applied exactly; automatic selection uses the latest shared date in stored history.",
      },
    },
    {
      id: "paths", label: { ko: "1,000개 흐름", en: "1,000 paths" },
      title: { ko: "과거의 짧은 흐름을 다시 이어 붙여요", en: "Join short stretches of history in new orders" },
      body: {
        ko: "과거의 어느 날에서 시작해 다음 날들을 이어가다가, 다른 날로 다시 이동합니다. 평균 5개 구간씩 연결하는 이 과정을 반복해 1,000개의 가능한 경로를 만듭니다.",
        en: "Start at a sampled past date, continue through the following dates, then jump to another date. Repeat this with stretches averaging five intervals to create 1,000 possible paths.",
      },
      nodes: [
        { label: { ko: "과거의 짧은 묶음", en: "Short historical stretches" } },
        { label: { ko: "순서를 바꿔 연결", en: "Reconnect the stretches" } },
        { label: { ko: "1,000개 경로", en: "1,000 paths" }, detail: { ko: "63 또는 126단계", en: "63 or 126 steps" } },
      ],
      takeAway: { ko: "종목을 중간에 사고팔아 비중을 맞추지 않습니다. 출발 구성 그대로 보유한다고 가정합니다.", en: "No trades rebalance the portfolio along a path. Each path assumes you keep the initial holdings." },
      detail: {
        ko: "이 방식은 정상 블록 부트스트랩입니다. 매 단계 20% 확률로 새 시작일을 고르므로 묶음 길이는 매번 다르며 평균이 5입니다. 63·126은 수익률 관측 단계 수이며 달력 일수가 아닙니다. 같은 입력·설정이면 같은 경로를 재현합니다. 메인 차트는 1,000개 경로를 모두 표시합니다. 비중 후보 차트는 표본 12개를 표시하지만 요약 수치는 전체 경로로 구합니다.",
        en: "This is a stationary bootstrap. Each step has a 20% chance of choosing a new starting date, so stretch lengths vary and average five. The 63 or 126 steps count return observations, not calendar days. Identical inputs and settings reproduce the same paths. The main chart displays all 1,000 paths. Candidate charts display 12 samples, while summary statistics use every path.",
      },
    },
    {
      id: "results", label: { ko: "결과 읽기", en: "Read the result" },
      title: { ko: "마지막 결과와 중간 하락을 따로 봐요", en: "Separate the final result from drops along the way" },
      body: {
        ko: "차트의 가운데 선은 각 시점에서 1,000개 값의 중간값입니다. 손실로 끝난 비율은 마지막 값이 출발점보다 낮은 경로를 세고, 최대 하락폭은 각 경로가 중간 고점에서 얼마나 내려갔는지 봅니다.",
        en: "The middle line marks the middle of the 1,000 values at each step. The loss share counts paths ending below their start. Maximum drawdown measures each path’s largest drop from an earlier peak.",
      },
      nodes: [
        { label: { ko: "같은 1,000개 경로", en: "The same 1,000 paths" } },
        { label: { ko: "마지막과 도중의 값", en: "Final and interim values" } },
        { label: { ko: "중간값·손실·최대 하락", en: "Middle value, loss and largest drop" } },
      ],
      takeAway: { ko: "마지막에 수익이 나도, 오는 길에 큰 하락을 겪을 수 있습니다.", en: "A path can finish with a gain after experiencing a large drop along the way." },
      example: {
        label: { ko: "개념 예시 · 내 계산 결과 아님", en: "Illustrative example · Not your result" },
        body: { ko: "100 → 120 → 90 → 110이라면 마지막 수익은 +10%입니다. 하지만 고점 120에서 90까지 내려간 최대 하락폭은 25%입니다.", en: "For 100 → 120 → 90 → 110, the final gain is +10%. But the largest drop, from the peak of 120 to 90, is 25%." },
      },
      detail: {
        ko: "P10·P50·P90은 값을 작은 순서대로 놓았을 때 약 10%·50%·90% 위치의 경계입니다. 차트의 P10~P90은 각 시점에서 가운데 약 80% 경로의 범위입니다. MDD P90은 1,000개 경로의 최대 하락폭 중 약 90%가 그 이하인 경계로, 나머지 약 10%는 더 크게 하락했습니다. P50은 평균값이나 가장 가능성 높은 하나의 경로가 아닙니다.",
        en: "P10, P50 and P90 mark approximately the 10th, 50th and 90th percentile of sorted values. The chart’s P10–P90 band contains the middle roughly 80% of paths at each step. MDD P90 is a drawdown threshold at or below which roughly 90% of paths fall; about 10% experienced larger drops. P50 is neither an average nor a single most likely path.",
      },
    },
  ],
  notes: [
    { title: { ko: "80% 범위가 미래를 보장하나요?", en: "Does the 80% band guarantee the future?" }, body: { ko: "아니요. 과거 자료를 다시 조합한 1,000개 경로 안의 범위입니다. 새로운 사건이나 과거에 없던 움직임은 충분히 담지 못할 수 있습니다.", en: "No. It is a range within 1,000 paths assembled from past data. New events or movements absent from that history may not be represented well." } },
    { title: { ko: "별도 모형도 같은 계산인가요?", en: "Do the other models use the same calculation?" }, body: { ko: "고정 종목·고정 비중 연구는 같은 재표본 추출 엔진으로 별도의 구성을 계산합니다. 환율·금리 요인 모형과 시장 국면 연구는 별도 방법이며 메인 경로에 섞거나 평균내지 않습니다.", en: "Fixed-instrument and fixed-weight research uses the same resampling engine with separate compositions. The FX/rates factor model and market-regime research use separate methods; their results are not mixed or averaged into the main paths." } },
    { title: { ko: "과거 검증은 무엇을 확인하나요?", en: "What does historical validation check?" }, body: { ko: "과거 시점까지의 자료로 계산하고, 계산에 쓰지 않은 다음 구간의 실제 결과와 대조합니다. 현재 구성으로 하는 점검이며, 당시 내 실제 보유량·매매를 재현한 투자 성과는 아닙니다.", en: "It calculates using data available up to a past point, then compares with actual outcomes in the following unused interval. It tests the current composition, not investment performance reconstructed from your historical holdings and trades." } },
  ],
  footnote: { ko: "계산만 제공합니다. 실제 주문은 실행하지 않으며 수수료·세금·현금수익률은 포함하지 않습니다.", en: "Calculation only. No actual orders are placed. Fees, taxes and cash returns are excluded." },
} as const satisfies CalculationGuideDefinition;
