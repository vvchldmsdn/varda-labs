import type { MethodGuide } from "./method-types";

// Presentation authority, with no calculation or data-loading responsibility:
// src/app/investment-lab/page.tsx → src/db/queries/investment-lab.ts
// → src/lib/investment-lab-counterfactual-read-loader.ts.
// Current-holding panels: src/app/api/research/investment-lab/route.ts
// → src/db/queries/investment-lab-detail.ts.
// All figures below are synthetic teaching examples, never account evidence.
export const investmentLabMethod = {
  title: { ko: "투자 랩의 수식과 계산 과정", en: "Investment Lab: formulas and methods" },
  intro: {
    ko: "과거 투자 방법 비교, 현재 비중 이동, 과거 충격 재현은 서로 다른 질문에 답합니다. 각 계산에서 고정하는 값과 바꾸는 값을 구분해 읽어 보세요. 아래 그림과 숫자는 원리를 설명하는 가상 예시입니다.",
    en: "Historical strategy comparisons, transfers within today's allocation, and historical stress replays answer different questions. Read each method with its fixed inputs and changing inputs in mind. The figures and numbers below are synthetic teaching examples.",
  },
  sections: [
    // src/lib/investment-lab-counterfactual-path.ts
    // src/lib/investment-lab-voo-path.ts; investment-lab-voo-evidence.ts
    // src/lib/investment-lab-event-flow.ts; investment-lab-fixed-mix.ts
    {
      id: "historical-boundary",
      title: { ko: "1. 같은 시작금액과 투자금 흐름으로 비교", en: "1. Match the starting value and investment flows" },
      lead: {
        ko: "실제 경로는 선택한 기간의 평가 기록입니다. 가상 경로는 첫 비교일의 같은 평가액으로 시작해 이후 실제 매수·매도 금액을 재사용합니다. 비교 대상은 투자된 보유자산이며, 계좌의 미투자 현금은 포함하지 않습니다.",
        en: "The actual path comes from valuation records for the selected period. The hypothetical path starts with the same value on the first comparison date and reuses subsequent recorded buy and sell amounts. The measured boundary contains invested holdings; uninvested account cash sits outside it.",
      },
      equations: [
        { expression: "Pᵂᵢ,ₜ = pᵢ,ₜ × xᵢ,ₜ", reading: { ko: "현지 통화 가격에 해당 평가에 쓰이는 환율을 곱하면 원화 단위가격입니다. 원화 자산의 환율은 1입니다.", en: "Local-currency price times the FX rate admitted for that valuation gives the KRW unit price. KRW assets use an FX factor of 1." } },
        { expression: "qᵢ,₀ = A₀ × wᵢ / Pᵂᵢ,₀\nSₜ = Σᵢ qᵢ,ₜ × Pᵂᵢ,ₜ", reading: { ko: "시작 평가액을 선택한 비중대로 나누어 가상 수량을 정합니다. 이후 날짜별 가상 평가액은 각 수량과 원화 단위가격을 곱한 합입니다. 이 식은 가격이 있는 자산의 배분을 설명합니다.", en: "Allocate the starting value by the selected weights to obtain hypothetical units. Later hypothetical value is the sum of units times KRW unit prices. This allocation formula describes assets with price evidence." } },
        { expression: "ΔVₜ = Sₜ − Aₜ", reading: { ko: "같은 날짜의 가상 평가액에서 실제 평가액을 빼면 금액 차이입니다. 투자금을 추가한 영향까지 포함하는 금액이므로 수익률과는 구분합니다.", en: "Subtract actual value from hypothetical value on the same date to get the value difference. Values also reflect added investment money, so this difference is distinct from return." } },
      ],
      symbols: [
        { symbol: "t, i", meaning: { ko: "t는 비교 관측일, i는 시나리오 자산입니다. 0은 첫 비교일입니다.", en: "t denotes a comparison observation date, i a scenario asset, and 0 the first comparison date." } },
        { symbol: "Aₜ, Sₜ", meaning: { ko: "각각 실제 기록 평가액과 가상 보유자산 평가액, 단위는 원입니다.", en: "Recorded actual value and hypothetical invested value, both in KRW." } },
        { symbol: "pᵢ,ₜ, xᵢ,ₜ, Pᵂᵢ,ₜ", meaning: { ko: "채택된 현지 가격, 현지 통화 1단위당 원화 환율, 원화 단위가격입니다.", en: "Admitted local price, KRW per unit of local currency, and KRW unit price." } },
        { symbol: "wᵢ, qᵢ,ₜ", meaning: { ko: "시작 배분 비중과 가상 보유 수량입니다. 비중은 합계 1이며 소수점 수량을 허용합니다.", en: "Starting allocation weight and hypothetical units. Weights sum to 1, and fractional units are allowed." } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "개념 예시 · 추가 매매가 없는 단일 자산의 평가 과정", en: "Illustrative example · valuing one asset without later trades" },
        nodes: [
          { label: { ko: "같은 100만 원", en: "Same KRW 1,000,000" }, detail: { ko: "시작가격 1만 원 → 100주", en: "KRW 10,000 per unit → 100 units" } },
          { label: { ko: "가상 평가액 110만 원", en: "Hypothetical KRW 1,100,000" }, detail: { ko: "100주 × 1만 1천 원", en: "100 units × KRW 11,000" } },
          { label: { ko: "금액 차이 +5만 원", en: "Value difference +KRW 50,000" }, detail: { ko: "같은 날 실제 평가액 105만 원과 비교", en: "Compare with actual value of KRW 1,050,000 on that date" } },
        ],
      },
      example: {
        ko: "입금 뒤 매수했다면 매수 금액만 투자자산 안으로 들어온 흐름으로 셉니다. 입금과 매수를 두 번 더하지 않습니다. 종목 등록·제외 기록만으로 매매 금액을 만들지도 않습니다.",
        en: "When a deposit is followed by a purchase, only the purchase amount enters the invested boundary. The deposit and purchase are not counted twice. Adding or removing a holding record alone does not create a trade amount.",
      },
      caveat: {
        ko: "실제 경로는 오늘의 종목을 과거로 되돌려 만든 것이 아닙니다. 비교에는 날짜와 평가 근거가 맞는 기록이 필요합니다. VOO 평가는 원종가와 해당 관측일에 저장된 환율 근거를 사용하며 배당 재투자는 제외합니다. 시나리오별 가격 기준과 수동 평가 자산의 처리 방식은 선택 옆의 비교 기준에서 확인하세요.",
        en: "The actual path is not reconstructed by projecting today's holdings backward. Comparisons require matching dates and valuation evidence. VOO valuations use raw closes and stored FX evidence for the observation date, excluding dividend reinvestment. Check Comparison basis beside the scenario for its price basis and treatment of manually valued assets.",
      },
    },
    // src/lib/investment-lab-execution-schedule.ts
    // src/lib/investment-lab-fixed-mix-flows.ts
    // src/lib/investment-lab-anchor-scheduled-rebalance.ts
    {
      id: "hypothetical-execution",
      title: { ko: "2. 매매 금액을 가상 수량으로 바꾸기", en: "2. Convert trade amounts into hypothetical units" },
      lead: {
        ko: "매수는 가상 수량을 늘리고 매도는 줄입니다. 실제 기록의 금액과 순서를 유지하되, 가상 자산에서 사용할 수 있는 가격으로 집행합니다. 매매일 당일 가격이 없으면 허용된 기간 안의 첫 유효한 이후 종가까지 기다립니다.",
        en: "Buys increase hypothetical units and sells reduce them. The model preserves recorded amounts and order, executing against prices available for the hypothetical asset. If the trade date has no eligible close, it waits for the first eligible later close within the allowed interval.",
      },
      equations: [
        { expression: "Cⱼ = +Bⱼ (buy),  −Bⱼ (sell)\nq⁺ = q⁻ + Cⱼ / Pᵂₑⱼ", reading: { ko: "단일 자산에서 매수 금액은 양수, 매도 금액은 음수로 놓습니다. 이를 집행 원화가격으로 나눈 수량을 기존 가상 수량에 더합니다.", en: "For a single asset, a buy amount is positive and a sell amount negative. Divide that signed amount by the execution price in KRW and add the resulting units to the prior holding." } },
        { expression: "Cᵢ,ⱼ = wᵢ × Cⱼ\nSₜ(mix) = wₖ × Sₜ(KODEX 200) + wᵥ × Sₜ(VOO)", reading: { ko: "두 ETF 혼합은 시작금액과 각 매매 금액을 선택 비중으로 나눕니다. 두 단일 ETF 경로를 같은 비율로 합치며 시장 휴일에 따라 각 몫의 집행일이 달라질 수 있습니다.", en: "The two-ETF mix splits the initial value and each trade amount by the selected weights. It combines the two single-ETF paths in those proportions; market holidays can give the two portions different execution dates." } },
        { expression: "qᵢ⁺ = wᵢ(target) × V(listed) / Pᵂᵢ,ₜ", reading: { ko: "월간 비중 유지 시나리오에서는 조정 대상 상장자산의 합계 평가액을 목표 비중으로 다시 나눕니다. 월이 바뀐 뒤 관측일에 먼저 도래한 매매를 처리하고, 대기 중인 매매가 없을 때 적용합니다.", en: "Monthly-maintenance scenarios redistribute the listed assets' combined value to target weights. After a month change, an observation first processes due trades and rebalances only when no active trade portions remain pending." } },
      ],
      symbols: [
        { symbol: "j, Bⱼ, Cⱼ", meaning: { ko: "매매 순서 j, 양수인 원화 매매 금액 B, 매수·매도 부호를 붙인 금액 C입니다.", en: "j identifies a trade in sequence; B is its positive KRW amount, and C adds the buy or sell sign." } },
        { symbol: "eⱼ, q⁻, q⁺", meaning: { ko: "가상 집행일과 집행 전·후 수량입니다. 집행 가격일은 서비스 관측일로 변환해 반영합니다.", en: "Hypothetical execution date and units before and after execution. The execution price date is mapped to the service observation date." } },
        { symbol: "wₖ, wᵥ", meaning: { ko: "KODEX 200과 VOO에 선택한 배분 비중이며 합계는 1입니다.", en: "Selected allocation weights for KODEX 200 and VOO; they sum to 1." } },
        { symbol: "V(listed), wᵢ(target)", meaning: { ko: "월간 조정에 포함되는 상장자산의 총평가액과 그 안에서 합계 1인 목표 비중입니다.", en: "Total value of listed assets eligible for monthly rebalancing, and their target weights summing to 1." } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "개념 예시 · 같은 금액이라도 집행 가격에 따라 수량이 달라집니다", en: "Illustrative example · execution prices determine the units added or removed" },
        nodes: [
          { label: { ko: "100주로 시작", en: "Start with 100 units" }, detail: { ko: "시작 평가액 100만 원", en: "Starting value KRW 1,000,000" } },
          { label: { ko: "매수 후 120주", en: "120 units after buying" }, detail: { ko: "+20만 원 ÷ 1만 원 = +20주", en: "+KRW 200,000 ÷ KRW 10,000 = +20 units" } },
          { label: { ko: "매도 후 112주", en: "112 units after selling" }, detail: { ko: "−10만 원 ÷ 1만 2,500원 = −8주", en: "−KRW 100,000 ÷ KRW 12,500 = −8 units" } },
        ],
      },
      example: {
        ko: "마지막 가격이 1만 2,500원이면 보유자산 평가액은 112주 × 1만 2,500원 = 140만 원입니다. 매도로 회수한 10만 원은 이 보유자산 평가액 밖에 있습니다.",
        en: "At a final price of KRW 12,500, invested value is 112 × KRW 12,500 = KRW 1,400,000. The KRW 100,000 recovered by selling is outside this invested value.",
      },
      caveat: {
        ko: "가상 집행 대기는 최대 7달력일입니다. 매도에 필요한 평가액이 부족하면 공매도나 다른 계좌의 돈으로 채우지 않고 그 경로를 보류합니다. 대기 매수금과 매도 의무는 별도 표시하며 보유자산 평가액에 합치지 않습니다. 월간 유지가 없는 경로는 비중이 가격에 따라 변하도록 두고, 월간 유지에서도 수동 평가 자산은 조정 대상에서 제외합니다. 수수료·세금·환전 비용은 별도 차감하지 않습니다.",
        en: "Hypothetical execution can wait at most 7 calendar days. An unfunded sale makes the path unavailable; it is not financed by short selling or another account. Pending buy cash and sell obligations are disclosed separately from invested value. Paths without monthly maintenance allow weights to drift. Monthly rebalancing excludes manually valued assets. Fees, taxes, and FX costs are not separately deducted.",
      },
    },
    // src/lib/investment-lab-modified-dietz.ts; investment-lab-return-estimate.ts
    // src/lib/investment-lab-account-composition-return.ts
    // src/lib/investment-lab-path-risk.ts (365 calendar days, not 252 trading days).
    {
      id: "linked-dietz-return",
      title: { ko: "3. 투자금 흐름을 조정한 수익률과 위험", en: "3. Returns and risk adjusted for investment flows" },
      lead: {
        ko: "연속한 두 평가 기록 사이마다 Modified Dietz 추정수익률을 계산합니다. 기간 중 더 넣고 뺀 돈을 제외하고, 그 돈이 기간 안에 있었던 길이를 분모에 반영한 뒤 구간 수익률을 곱해서 연결합니다.",
        en: "A Modified Dietz return is estimated between each pair of successive valuation records. Net money added or removed is subtracted from the value change, its time in the interval affects the denominator, and interval growth factors are linked by multiplication.",
      },
      equations: [
        { expression: "aⱼ = (D − dⱼ) / D\nHₖ = Bₖ + Σⱼ aⱼCⱼ", reading: { ko: "기간 전체 달력일 수에서 매매일까지 지난 일수를 빼면 남은 기간입니다. 그 비율을 매매 금액에 곱해 시작 평가액에 더하면 수익률 분모가 됩니다. 종료일 흐름의 가중치는 0입니다.", en: "Subtract elapsed calendar days at a flow from the interval length to find its remaining time. Weight each flow by that fraction and add it to opening value to obtain the return denominator. A flow on the ending date has weight 0." } },
        { expression: "rₖ = (Eₖ − Bₖ − Σⱼ Cⱼ) / Hₖ\nR = Πₖ(1 + rₖ) − 1", reading: { ko: "종료액에서 시작액과 순유입액을 뺀 값을 분모로 나눕니다. 전체 수익률은 각 구간의 1+수익률을 곱한 뒤 1을 뺍니다. 화면의 백분율은 이 값에 100을 곱한 것입니다.", en: "Subtract opening value and net inflows from closing value, then divide by the denominator. Total return is the product of one plus each interval return, minus one. Multiply by 100 to express it as the percentage shown on screen." } },
        { expression: "rₖ(all) = Σₐ(Eₐ,ₖ − Bₐ,ₖ − Σⱼ Cₐ,ⱼ) / Σₐ Hₐ,ₖ", reading: { ko: "계좌별 결과를 합성할 때는 같은 구간의 손익 분자와 분모를 각각 합칩니다. 계좌 수익률을 단순 평균하지 않습니다.", en: "When composing account results, sum their profit numerators and denominators over the same interval. Account returns are not simply averaged." } },
        { expression: "G₀ = 1\nGₖ = Πₗ₌₁…ₖ(1 + rₗ)\nMDD = maxₖ(1 − Gₖ / max₀≤ₗ≤ₖ Gₗ)", reading: { ko: "투자금 흐름을 조정한 성장 경로의 이전 최고점에서 가장 많이 내려간 비율이 최대낙폭입니다. 원화 평가액 그래프의 낙폭과는 기준이 다릅니다.", en: "Maximum drawdown is the largest proportional fall from a prior peak of the flow-adjusted growth path. Its basis differs from drawdown of the KRW valuation chart." } },
        { expression: "r̄ = Σₖ rₖ / n\nσannual = √(365 × Σₖ(rₖ − r̄)² / (n − 1))", reading: { ko: "투자 랩의 연환산 변동성은 일간 구간 수익률의 표본표준편차에 √365를 곱합니다. 모든 구간이 연속한 1달력일이고 최소 20개일 때만 제공합니다.", en: "Investment Lab annualized volatility multiplies the sample standard deviation of daily interval returns by √365. It is available only with at least 20 intervals, every one spanning a consecutive calendar day." } },
      ],
      symbols: [
        { symbol: "Bₖ, Eₖ", meaning: { ko: "구간 k의 시작·종료 보유자산 평가액입니다.", en: "Opening and closing invested values of interval k." } },
        { symbol: "D, dⱼ, aⱼ", meaning: { ko: "구간의 달력일 수, 흐름 j까지 지난 달력일 수, 남은 기간 비율입니다. 흐름은 일말 발생으로 가정합니다.", en: "Interval length in calendar days, days elapsed at flow j, and the fraction remaining. Flows are assumed to occur at the end of their dates." } },
        { symbol: "Cⱼ, Hₖ", meaning: { ko: "매수는 양수·매도는 음수인 흐름과 시간 가중치를 반영한 분모입니다. H가 0 이하이면 계산을 보류합니다.", en: "Signed flow, positive for a buy and negative for a sell, and the time-weighted denominator. Calculation is unavailable when H is non-positive." } },
        { symbol: "rₖ, R, a", meaning: { ko: "구간 수익률, 연결 전체 수익률, 합성 대상 계좌의 인덱스입니다.", en: "Interval return, linked total return, and an account index for composition." } },
        { symbol: "Gₖ, MDD", meaning: { ko: "1에서 시작한 연결 성장값과 양수 크기로 표현하는 최대낙폭입니다.", en: "Linked growth starting at 1, and maximum drawdown expressed as a nonnegative magnitude." } },
        { symbol: "n, r̄, σannual", meaning: { ko: "일간 구간 수, 그 수익률의 산술평균, 연환산 변동성입니다.", en: "Number of daily intervals, their arithmetic mean return, and annualized volatility." } },
      ],
      figure: {
        kind: "lines",
        caption: { ko: "개념 예시 · +10% 뒤 −10%면 연결 결과는 −1%입니다", en: "Illustrative example · +10% followed by −10% links to −1%" },
        xLabel: { ko: "연속 평가 구간", en: "Successive valuation intervals" },
        yLabel: { ko: "흐름 조정 성장지수 · 시작 100", en: "Flow-adjusted growth index · start 100" },
        series: [{ label: { ko: "연결 성장", en: "Linked growth" }, values: [100, 110, 99] }],
      },
      example: {
        ko: "10일 구간이 100만 원에서 시작하고, 5일째 20만 원 매수 후 131만 원으로 끝났다면 분모는 100만 + 0.5×20만 = 110만 원입니다. 수익률은 (131만−100만−20만)/110만 = 10%입니다. 다음 구간 −10%와 연결하면 1.1×0.9−1 = −1%, 최고점 110에서 99까지 낙폭은 10%입니다.",
        en: "Suppose a 10-day interval opens at KRW 1,000,000, a KRW 200,000 buy occurs on day 5, and it closes at KRW 1,310,000. The denominator is 1,000,000 + 0.5×200,000 = 1,100,000. Return is (1,310,000−1,000,000−200,000)/1,100,000 = 10%. A following −10% interval links to 1.1×0.9−1 = −1%; the fall from 110 to 99 is 10%.",
      },
      caveat: {
        ko: "일말 가정의 추정치이며 매매 순간마다 평가하는 정확한 시간가중수익률이나 내부수익률은 아닙니다. 실제 흐름은 기록 매매일을 변환한 관측일에, 가상 흐름은 가상 집행 관측일에 반영하므로 휴일에는 시점이 다를 수 있습니다. 가격 기준·흐름·평가 근거가 맞지 않으면 수익률을 표시하지 않습니다. 불규칙한 관측이어도 계산 가능한 낙폭은 남기지만 연환산 변동성은 비워 둡니다. 그림의 두 구간만으로 변동성을 계산하지 않습니다.",
        en: "This is an end-of-day estimate, not exact time-weighted return measured at every trade or an internal rate of return. Actual flows use observation dates mapped from recorded trades; hypothetical flows use their execution observation dates, which holidays may delay. Returns are withheld when price bases, flows, or valuations do not reconcile. Irregular observations may still support drawdown while annualized volatility remains unavailable. The figure's two intervals are insufficient for volatility.",
      },
    },
    // src/lib/investment-lab-small-adjustment.ts; investment-lab-small-adjustment-types.ts
    // src/lib/portfolio-direct-holdings.ts
    {
      id: "current-transfer",
      title: { ko: "4. 현재 평가액을 옮기면 집중도가 어떻게 변할까", en: "4. How a transfer changes today's concentration" },
      lead: {
        ko: "현재 비중 실험은 한 계좌 안의 보유종목 A에서 B로 원화 평가액을 옮겨 보는 계산입니다. 현재 총평가액을 유지하면서 종목 비중, 가장 큰 종목의 비중, 직접보유 집중도와 통화별 비중을 다시 구합니다.",
        en: "The current-allocation experiment moves a KRW value from holding A to holding B within one account. It preserves current total value and recalculates holding weights, the largest holding's weight, direct-holding concentration, and weights by currency.",
      },
      equations: [
        { expression: "V′ₐ = Vₐ − T\nV′ᵦ = Vᵦ + T\nΣᵢ V′ᵢ = Σᵢ Vᵢ = V", reading: { ko: "출발 종목에서 이동액을 빼고 도착 종목에 같은 금액을 더합니다. 외부 투자금 유입 없이 계좌 합계는 그대로입니다.", en: "Subtract the transfer from the source and add the same amount to the destination. The account total stays unchanged, with no external investment flow." } },
        { expression: "wᵢ = Vᵢ / V\nHHI = 10,000 × Σᵢ wᵢ²\nLargest = 100 × maxᵢ wᵢ", reading: { ko: "비중의 제곱을 더하고 1만을 곱하면 HHI입니다. 특정 직접보유 종목에 돈이 몰릴수록 커집니다. Largest는 가장 큰 종목의 비중을 백분율로 표현합니다.", en: "HHI is the sum of squared weights multiplied by 10,000. It rises when value is concentrated in particular direct holdings. Largest expresses the biggest holding's weight as a percentage." } },
        { expression: "Currency(c) = 100 × Σᵢ∈c Vᵢ / V", reading: { ko: "같은 표시 통화의 종목 평가액을 더한 뒤 전체로 나누면 그 통화별 비중입니다. 이동 전후의 같은 공식을 비교합니다.", en: "Sum the values of holdings denominated in one currency and divide by total value to obtain that currency's weight. Apply the same formula before and after the transfer." } },
      ],
      symbols: [
        { symbol: "Vᵢ, V, V′ᵢ", meaning: { ko: "현재 종목 평가액, 현재 계좌 총평가액, 이동 후 가상 종목 평가액입니다. 모두 원화입니다.", en: "Current holding value, current account total, and hypothetical holding value after the transfer, all in KRW." } },
        { symbol: "T, A, B", meaning: { ko: "1원 이상 정수인 이동액과 같은 계좌의 서로 다른 출발·도착 종목입니다. T는 출발 종목 평가액 이하여야 합니다.", en: "A transfer amount of at least one whole KRW and two different source and destination holdings in the same account. T cannot exceed source value." } },
        { symbol: "wᵢ, c", meaning: { ko: "직접보유 종목의 비중과 종목의 표시 통화입니다. 동일 계좌·시장·통화·티커의 중복 행은 합쳐서 계산합니다.", en: "A direct holding's weight and denomination currency. Duplicate rows sharing account, market, currency, and ticker are aggregated." } },
      ],
      figure: {
        kind: "bars",
        caption: { ko: "개념 예시 · 총 100만 원에서 A→B로 20만 원 이동", en: "Illustrative example · transfer KRW 200,000 from A to B within KRW 1,000,000" },
        rows: [
          { label: { ko: "A 이동 전", en: "A before" }, value: 70 },
          { label: { ko: "A 이동 후", en: "A after" }, value: 50 },
          { label: { ko: "B 이동 전", en: "B before" }, value: 30 },
          { label: { ko: "B 이동 후", en: "B after" }, value: 50 },
        ],
        unit: { ko: "%", en: "%" },
      },
      example: {
        ko: "70만·30만 원을 50만·50만 원으로 바꾸면 HHI는 10,000×(0.7²+0.3²)=5,800에서 10,000×(0.5²+0.5²)=5,000이 됩니다. 가장 큰 종목의 비중은 70%에서 50%로 줄어듭니다.",
        en: "Changing KRW 700,000 and 300,000 to 500,000 each changes HHI from 10,000×(0.7²+0.3²)=5,800 to 10,000×(0.5²+0.5²)=5,000. The largest holding's weight falls from 70% to 50%.",
      },
      caveat: {
        ko: "이 계산은 화면 안의 가상 평가액 이동이며 매수·매도 기록을 저장하거나 주문하지 않습니다. 과거 자금 흐름이나 향후 가격 경로를 재현하지 않으며, 낮은 HHI가 낮은 가격 위험을 보장하지도 않습니다. ETF 내부 종목과의 중복, 환헤지, 기초자산의 경제적 통화 노출은 이 직접보유 지표에 포함하지 않습니다. 계좌 평가가 빠지거나 종목 식별이 불완전하면 계산을 보류합니다.",
        en: "This is a hypothetical value transfer held in the screen; it saves no buy or sell records and places no orders. It does not replay historical flows or project future prices, and lower HHI does not guarantee lower market risk. These direct-holding metrics do not look through ETF constituents, currency hedges, or underlying economic currency exposure. Incomplete account valuations or holding identities make the calculation unavailable.",
      },
    },
    // src/db/queries/investment-lab-stress-replay.ts
    // src/lib/investment-lab-stress-replay.ts: buildInstrumentPath,
    // weightedStrategy, readyStrategy, maxDrawdown, worstDayReturn.
    {
      id: "stress-replay",
      title: { ko: "5. 지금 구성을 과거 충격 구간에 놓아 보기", en: "5. Replay today's composition through a historical window" },
      lead: {
        ko: "현재 보유종목과 평가액 비중을 코로나 급락·2022 금리 충격·2023 AI 상승 구간의 가격 변화에 적용합니다. 시작 비중으로 매수해 유지하는 경로이며, 사용자의 당시 보유내역이나 매매를 재현하는 계산은 아닙니다.",
        en: "Current holdings and value weights are applied to price changes during the COVID selloff, the 2022 rate shock, and the 2023 AI rally. The path buys at the starting weights and holds. It does not reconstruct what you held or traded at that time.",
      },
      equations: [
        { expression: "fᵢ,ₜ = (pᵢ,ₜ × xᵢ,ₜ) / (pᵢ,₀ × xᵢ,₀)", reading: { ko: "과거 각 날짜의 원화 단위가격을 그 구간 첫날 가격으로 나누면 종목별 성장 배수입니다. 환율 변화도 달러 자산의 원화 경로에 반영됩니다.", en: "Divide each historical KRW unit price by its first-window-date value to obtain the instrument's growth factor. FX changes therefore affect dollar assets' KRW paths." } },
        { expression: "wᵢ = Vᵢ(now) / Σⱼ∈E Vⱼ(now)\nGₜ = Σᵢ∈E wᵢfᵢ,ₜ", reading: { ko: "해당 구간의 가격·환율 근거가 충분한 종목끼리 현재 평가액 비중을 다시 정규화합니다. 그 시작 비중으로 종목별 성장 배수를 더합니다. 동일 비중 경로는 wᵢ=1/종목 수를 씁니다.", en: "Renormalize current value weights across instruments with sufficient price and FX evidence for that window. Sum their growth factors using those initial weights. The equal-weight path uses wᵢ=1/instrument count." } },
        { expression: "Coverage = 100 × Σᵢ∈E Vᵢ(now) / V(scope, now)\nIndexₜ = 100 × Gₜ", reading: { ko: "계산 가능한 종목의 현재 평가액이 선택 범위의 얼마를 설명하는지 적용 범위로 표시합니다. 성장 배수 1을 그림에서는 시작지수 100으로 바꿔 볼 수 있습니다.", en: "Coverage reports how much of the selected scope's current value is represented by eligible instruments. A growth factor of 1 can be displayed as an index starting at 100, as in this illustration." } },
        { expression: "Return = 100 × (Gend / G₀ − 1)\nMDD = 100 × maxₜ(1 − Gₜ / maxₛ≤ₜ Gₛ)", reading: { ko: "구간 마지막과 처음의 비율로 기간수익률을, 경로의 이전 최고점 대비 하락폭으로 최대낙폭을 구합니다. 이 경로에는 중간 자금 유입·유출이 없습니다.", en: "The final-to-initial ratio gives period return. The greatest fall from a prior path peak gives maximum drawdown. This path has no intermediate external flows." } },
        { expression: "Worst = 100 × min(0, minₜ>₀(Gₜ / Gₜ₋₁ − 1))", reading: { ko: "평일 평가축에서 직전 값 대비 변화 중 가장 낮은 값을 최악의 하루로 표시합니다. 모두 상승하거나 같았다면 0%입니다.", en: "Worst day is the lowest change from the preceding point on the weekday valuation axis. It is 0% when every change is nonnegative." } },
      ],
      symbols: [
        { symbol: "E, Vᵢ(now), V(scope, now)", meaning: { ko: "해당 과거 구간에 필요한 근거를 갖춘 종목 집합, 종목의 현재 평가액, 선택 범위의 현재 평가액입니다.", en: "The eligible instrument set for the historical window, each instrument's current value, and the selected scope's current value." } },
        { symbol: "pᵢ,ₜ, xᵢ,ₜ", meaning: { ko: "구간의 채택된 과거 종가와 과거 환율입니다. 원화 자산은 x=1이며 달러 자산만 USD/KRW를 적용합니다.", en: "Admitted historical close and historical FX rate in the window. KRW assets use x=1; USD assets use USD/KRW." } },
        { symbol: "fᵢ,ₜ, wᵢ, Gₜ", meaning: { ko: "종목 성장 배수, 재현 시작 비중, 포트폴리오 성장 배수입니다. G는 1에서 시작합니다.", en: "Instrument growth factor, replay starting weight, and portfolio growth factor. G starts at 1." } },
        { symbol: "Coverage, MDD, Worst", meaning: { ko: "현재 평가액 적용 범위, 최대낙폭의 양수 크기, 가장 낮은 하루 변화이며 모두 %입니다.", en: "Current-value coverage, nonnegative maximum drawdown magnitude, and lowest daily change, all in percent." } },
      ],
      figure: {
        kind: "lines",
        caption: { ko: "개념 예시 · 처음에 A 75%·B 25%로 매수한 뒤 보유, 실제 시장 자료 아님", en: "Illustrative example · buy and hold from A 75%, B 25%; not market data" },
        xLabel: { ko: "과거 구간의 평가 순서", en: "Observation order in the historical window" },
        yLabel: { ko: "성장지수 · 시작 100", en: "Growth index · start 100" },
        series: [
          { label: { ko: "가상 구성", en: "Illustrative composition" }, values: [100, 85, 97.5] },
          { label: { ko: "무이자 원화 현금", en: "Zero-interest KRW cash" }, values: [100, 100, 100] },
        ],
      },
      example: {
        ko: "A의 배수가 1→0.8→0.9, B가 1→1→1.2라면 75%·25% 경로는 1→0.85→0.975입니다. 따라서 기간수익률 −2.5%, 최대낙폭 15%, 최악의 하루 −15%입니다. 계산 가능한 종목의 현재 가치가 전체 100만 원 중 80만 원이면 적용 범위는 80%이며, 위 비중은 그 80만 원 안에서 정규화합니다.",
        en: "If A's factors are 1→0.8→0.9 and B's are 1→1→1.2, a 75%/25% path is 1→0.85→0.975. Period return is −2.5%, maximum drawdown 15%, and worst day −15%. If eligible holdings represent KRW 800,000 of a KRW 1,000,000 scope, coverage is 80%; the weights are normalized within that KRW 800,000.",
      },
      caveat: {
        ko: "현재 평가액부터 누락된 경우에는 재현을 시작하지 않습니다. 과거 근거만 없는 종목은 제외하고 적용 범위를 공개하므로 부분 결과를 전체 포트폴리오 결과로 읽으면 안 됩니다. 평일축의 가격은 최대 7달력일, 환율은 5달력일까지 이전 근거를 사용할 수 있습니다. 원종가 경로는 배당·기업행동 조정이 빠질 수 있고 거래비용·리밸런싱·현금 이자는 없습니다. 오늘 구성을 과거에 놓는 사후 실험이므로 당시 실행 가능성이나 미래 성과를 입증하지 않습니다.",
        en: "Missing current valuations prevent a replay. Instruments missing only historical evidence are excluded with coverage disclosed, so a partial result cannot represent the whole portfolio. On the weekday axis, earlier prices may carry for up to 7 calendar days and FX for 5. Raw-close paths may omit dividend and corporate-action adjustments. There are no trading costs, rebalancing, or cash interest. Applying today's composition to the past is a hindsight experiment, not evidence of historical investability or future performance.",
      },
    },
  ],
} satisfies MethodGuide;
