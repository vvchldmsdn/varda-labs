import type { CalculationGuideDefinition } from "@/components/explanations/calculation-guide-types";

/** Presentation of the connected position-flow, execution, and Modified Dietz engines. */
export const investmentLabCalculationGuide = {
  id: "investment-lab-method",
  intro: {
    ko: "그때 다른 자산을 골랐다면 어땠을까요? 실제 기록은 그대로 두고, 투자 방법만 바꾼 과거 경로를 나란히 봅니다.",
    en: "What if you had chosen different assets? Keep your actual records and compare them with a historical path using a different investment method.",
  },
  steps: [
    {
      id: "starting-point", label: { ko: "출발점", en: "Start" },
      title: { ko: "같은 날, 같은 금액에서 시작해요", en: "Start on the same date with the same amount" },
      body: {
        ko: "선택한 계좌와 기간의 첫 저장 평가액을 출발점으로 삼습니다. 검은 선은 실제 기록, 주황 선은 선택한 자산에 그 금액을 투자했다고 가정한 계산입니다.",
        en: "The first recorded value in your selected scope and period is the starting point. The black line follows your records; the orange line assumes that amount was invested in the selected assets.",
      },
      nodes: [
        { label: { ko: "계좌 · 기간 선택", en: "Choose scope and period" }, detail: { ko: "저장된 보유자산 평가액", en: "Recorded value of invested assets" } },
        { label: { ko: "같은 시작 금액", en: "Same starting value" }, detail: { ko: "실제 기록과 가상 투자", en: "Actual records and hypothetical holdings" } },
      ],
      takeAway: { ko: "현금 잔액을 포함한 통장 전체가 아니라, 투자한 자산의 평가액을 비교합니다.", en: "This compares invested assets, not your entire account including uninvested cash." },
      detail: { ko: "선택 범위에 속한 계좌의 기록이 같은 날짜에 맞아야 합니다. 서로 다른 저장 방식의 기록이나 불완전한 계좌 합계를 임의로 이어 붙이지 않습니다.", en: "The accounts in your scope need matching dates. Records with incompatible recording methods or incomplete account totals are not joined artificially." },
    },
    {
      id: "trade-flows", label: { ko: "매매 재현", en: "Replay trades" },
      title: { ko: "실제로 투자하고 회수한 금액을 따라가요", en: "Follow the amounts you invested and withdrew from investments" },
      body: {
        ko: "실제 매수에 쓴 금액은 가상 자산에도 투자하고, 매도로 회수한 금액은 가상 자산에서도 뺍니다. 계좌에 입금만 하고 투자하지 않은 돈을 새 매수로 세지 않습니다.",
        en: "Money used for actual purchases also enters the hypothetical assets. Money recovered from sales leaves them. A cash deposit alone is not counted as a new investment.",
      },
      nodes: [
        { label: { ko: "실제 매수 · 매도 기록", en: "Actual purchase and sale records" } },
        { label: { ko: "같은 금액 재현", en: "Replay the same amounts" }, detail: { ko: "선택한 자산 · 배분 방식", en: "Selected assets and allocation rule" } },
        { label: { ko: "가상 보유 수량", en: "Hypothetical units" } },
      ],
      takeAway: { ko: "돈을 더 넣었기 때문에 커진 효과와, 투자 방법 때문에 달라진 효과를 구별하기 위한 과정입니다.", en: "This helps separate the effect of investing more money from the effect of choosing a different method." },
      detail: { ko: "매매 당일의 유효 종가가 없으면 이후 첫 유효 종가로 처리합니다. 미래 가격을 앞당겨 쓰지 않으며, 허용된 대기 기간을 넘으면 계산을 보류합니다. 같은 날의 여러 매매도 원래 순서대로 처리합니다.", en: "If no eligible close exists on the trade date, execution uses the first eligible later close. Future prices are never moved back in time. Trades retain their original order, and calculations stop if execution exceeds the permitted waiting period." },
    },
    {
      id: "value-paths", label: { ko: "날짜별 계산", en: "Value each date" },
      title: { ko: "그날의 가격으로 얼마인지 계산해요", en: "Use the prices for each observation date" },
      body: {
        ko: "가상 보유 수량에 그날 사용할 수 있는 가격을 곱해 평가액을 구합니다. 달러 자산은 그 날짜의 환율로 원화로 바꿉니다. 실제 기록과 같은 날짜끼리 나란히 표시합니다.",
        en: "Hypothetical units are multiplied by the price available for that date. Dollar assets use the date-specific exchange rate to express their value in KRW. Only matching dates are compared.",
      },
      nodes: [
        { label: { ko: "가상 수량 × 가격", en: "Hypothetical units × price" }, detail: { ko: "필요하면 해당 날짜 환율 적용", en: "Apply that date's FX rate where needed" } },
        { label: { ko: "날짜별 가상 평가액", en: "Hypothetical value by date" } },
        { label: { ko: "실제 기록과 비교", en: "Compare with recorded values" } },
      ],
      takeAway: { ko: "그래프 위를 누르면 같은 날짜의 실제 금액·가상 금액·차이를 볼 수 있어요.", en: "Tap the chart to inspect the actual value, hypothetical value, and difference on the same date." },
      detail: { ko: "가격이 없는 날의 평가는 허용 범위 안에서 이전 유효 가격을 사용합니다. 곡선은 저장된 관측점을 연결한 표시일 뿐 새 데이터를 만들지 않습니다. 가격·환율·매매 근거가 부족한 경로는 평균값으로 채우지 않습니다.", en: "Valuations can use an earlier eligible price within the allowed carry limit. Curves connect observations; they do not create data. Missing prices, FX, or trade evidence are not replaced with averages." },
    },
    {
      id: "read-results", label: { ko: "결과 읽기", en: "Read results" },
      title: { ko: "금액 차이와 수익률은 따로 읽어요", en: "Read value differences and returns separately" },
      body: {
        ko: "선택일의 차이는 가상 평가액에서 실제 평가액을 뺀 금액입니다. 추정수익률은 투자금을 넣고 뺀 영향과 그 시점을 따로 반영해, 투자 결과를 비율로 비교합니다.",
        en: "The selected-date difference is hypothetical value minus actual value. Estimated return adjusts for investment flows and their timing so performance can also be compared as a percentage.",
      },
      nodes: [
        { label: { ko: "같은 날짜 선택", en: "Choose a matching date" } },
        { label: { ko: "평가액 차이 확인", en: "Read the value difference" }, detail: { ko: "가상 평가액 − 실제 평가액", en: "Hypothetical value − actual value" } },
        { label: { ko: "수익률도 따로 확인", en: "Check returns separately" }, detail: { ko: "투자금 흐름을 조정한 별도 지표", en: "A separate metric adjusted for investment flows" } },
      ],
      takeAway: { ko: "과거에 더 높았던 경로가 앞으로도 더 좋다는 뜻은 아닙니다. 이 화면은 추천이나 주문을 만들지 않습니다.", en: "A higher historical path does not mean a better future outcome. This screen creates neither recommendations nor orders." },
      detail: { ko: "수익률은 관측 구간별 시작·종료 평가액과 매매 금액, 투자 기간을 이용한 Modified Dietz 추정치를 연결합니다. 최대낙폭은 이 수익 흐름이 이전 최고점에서 가장 크게 내려간 폭입니다. 근거가 부족하면 지표를 비워 둡니다.", en: "Returns link Modified Dietz estimates from each observation interval, using its opening and closing values, investment flows, and their timing. Maximum drawdown is the largest fall from a previous peak of this flow-adjusted growth path. Metrics remain unavailable when evidence is insufficient." },
    },
  ],
  notes: [
    { title: { ko: "용어 없이 이해하기", en: "A few terms in plain language" }, body: { ko: "평가액은 그날 보유자산이 얼마인지, 비중은 전체 중 한 자산의 몫입니다. 리밸런싱은 바뀐 비중을 정해 둔 비중으로 다시 맞추는 계산입니다. 변동성은 수익률이 얼마나 크게 흔들렸는지를 뜻합니다.", en: "Value means what the assets are worth on a date. Weight is one asset's share of the whole. Rebalancing restores a chosen allocation after weights drift. Volatility describes how much returns fluctuate." } },
    { title: { ko: "시나리오마다 바뀌는 것", en: "What changes between scenarios" }, body: { ko: "단일 ETF·두 ETF 혼합은 투자할 자산을 바꿉니다. 기준일 종목 비교는 시작 비중을 바꾸고, 월간 유지 경로는 매월 비중을 다시 맞춥니다. 월간 유지가 없는 경로는 가격이 움직여도 비중을 자동으로 되돌리지 않습니다. 선택 옆의 '비교 기준'에서 그 경로의 규칙을 확인하세요.", en: "Single-ETF and two-ETF scenarios change the assets. Anchor-holding scenarios change starting weights, while monthly scenarios restore their target weights each month. Other paths allow weights to drift with prices. Use 'Comparison basis' beside your selection to see its rule." } },
    { title: { ko: "실제 투자와 다른 점", en: "How the model differs from real investing" }, body: { ko: "가상 계산은 소수점 수량을 허용하며 거래비용·세금·환전 수수료를 별도로 차감하지 않습니다. 원종가를 쓰는 경로는 배당금이나 주식분할 같은 사건에 따른 가격 조정을 포함하지 않습니다. 수동 평가 자산은 저장된 평가 근거를 사용하며, 월간 비중 조정에서는 따로 유지합니다.", en: "Hypothetical calculations allow fractional units and do not separately deduct trading costs, taxes, or FX spreads. Raw-close paths omit adjustments for dividends and events such as stock splits. Manually valued assets use recorded evidence and remain separate from monthly rebalancing." } },
    { title: { ko: "일부 결과가 비어 있다면", en: "If some results are unavailable" }, body: { ko: "평가액·매매 금액·가격·환율이 서로 맞아야 계산할 수 있습니다. '데이터'에서 빠진 근거를 확인하세요. 일부 수익 경로가 보여도 연속된 일간 관측이 부족하면 연환산 변동성은 표시하지 않습니다.", en: "Values, trade amounts, prices, and FX records must reconcile. Check 'Data' for missing evidence. A return path can be available while annualized volatility remains unavailable because consecutive daily observations are insufficient." } },
  ],
  footnote: { ko: "결과에 사용된 실제 근거는 '데이터'와 '날짜별 수치'에서 확인할 수 있습니다.", en: "Review the evidence behind your results in 'Data' and 'Values by date'." },
} satisfies CalculationGuideDefinition;
