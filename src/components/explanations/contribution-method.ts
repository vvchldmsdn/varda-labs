import type { MethodGuide } from "./method-types";

// Display-only explanation of the connected calculation, not a second engine.
// Authorities: src/lib/additional-contribution-policy-engine.ts,
// additional-contribution-policy-input.ts, moving-average-window.ts,
// additional-contribution-ma120-operational-evidence.ts,
// additional-contribution-cash-reserve.ts, contribution-market-context.ts,
// and components/additional-contribution/contribution-adjustment-panel.tsx.
// Examples below are hypothetical arithmetic, never a user's portfolio result.
export const contributionMethod = {
  title: { ko: "추가투입은 어떻게 계산하나요?", en: "How is a contribution calculated?" },
  intro: {
    ko: "목표에서 벗어난 보유액을 먼저 점검하고, 필요한 경우 일부를 줄인 뒤, 새 돈과 매도대금을 목표 부족액에 나눕니다. 아래 숫자는 계산을 따라 해 볼 수 있는 가상 예시입니다. 결과는 원 단위 금액 계획이며 실제 주문을 실행하지 않습니다.",
    en: "First check how far holdings have moved from their targets, trim eligible positions, then share new cash and sale proceeds across target shortfalls. The numbers below are hypothetical worked examples. Results are whole-KRW allocation plans; they do not place orders.",
  },
  sections: [
    {
      id: "drift-and-trim",
      title: { ko: "1. 목표보다 커진 종목을 줄입니다", en: "1. Trim eligible overweight positions" },
      lead: {
        ko: "드리프트는 현재 비중이 목표보다 상대적으로 얼마나 큰지입니다. 기본 기준은 12%이며 설정에서 바꿀 수 있습니다. 기준 이상이어도 확인 가능한 양수의 매입원가가 있고 평가손익이 0 이상일 때만 매도액을 계산합니다. 전체 목표비중 합은 먼저 100%여야 합니다.",
        en: "Drift measures the relative excess over a target weight. Its default threshold is 12%, configurable in settings. Reaching that threshold is not enough: trimming also requires a known positive cost basis and a nonnegative unrealized return. All target weights must first sum to 100%.",
      },
      equations: [
        {
          expression: "V = Σvᵢ,  T = V + C,  wᵢ = vᵢ / V",
          reading: {
            ko: "현재 보유액을 합한 V에 새 돈 C를 더해 투입 후 총액 T를 구합니다. 현재 비중은 새 돈을 넣기 전 V를 기준으로 계산합니다. 매도는 자산을 현금으로 바꾸므로 T에 매도대금을 또 더하지 않습니다.",
            en: "Sum current holdings into V, then add new cash C to obtain the post-contribution total T. Current weights use V before the contribution. Selling converts holdings into cash, so sale proceeds are not added to T again.",
          },
        },
        {
          expression: "dᵢ = 100 × (wᵢ − tᵢ) / tᵢ,  uᵢ = 100 × (vᵢ − kᵢ) / kᵢ",
          reading: {
            ko: "t가 양수일 때 드리프트 d를 계산하고, 원가 k가 양수일 때 평가수익률 u를 계산합니다. 현재 22.4%, 목표 20%라면 드리프트는 12%입니다. 비중 차이인 2.4%포인트와 구분합니다.",
            en: "Compute drift d when t is positive, and unrealized return u when cost k is positive. A current weight of 22.4% against a 20% target gives 12% drift. This differs from the 2.4-percentage-point weight gap.",
          },
        },
        {
          expression: "sᵢ = max(0, floor(vᵢ − 1.05 × tᵢ × T))",
          reading: {
            ko: "매도 조건을 만족하면 투입 후 목표액의 105%를 남기는 방향으로 매도액을 계산하고 원 미만을 버립니다. 목표 0%는 원가·손익 조건을 만족할 때 floor(v)만큼 정리합니다. 조건을 만족하지 않으면 매도액은 0원입니다.",
            en: "For an eligible trim, aim to leave 105% of the post-contribution target value, rounding the sale down to whole KRW. A zero target uses floor(v) when the cost and return conditions are met. Otherwise the sale amount is zero.",
          },
        },
        {
          expression: "pᵢ = vᵢ − sᵢ,  S = Σsᵢ,  F = C + S",
          reading: {
            ko: "매도 후 보유액 p와 총 매도대금 S를 구합니다. 이후 매수에 사용할 재원 F는 새 돈과 매도대금의 합입니다.",
            en: "Compute post-trim holdings p and total sale proceeds S. The buying budget F is new cash plus those sale proceeds.",
          },
        },
      ],
      symbols: [
        { symbol: "vᵢ, kᵢ, pᵢ", meaning: { ko: "종목 i의 현재 평가액·매입원가·매도 후 보유액, 모두 원화", en: "Current value, cost basis and post-trim value of position i, all in KRW" } },
        { symbol: "wᵢ, tᵢ", meaning: { ko: "현재 비중과 목표비중, 수식에서는 20%를 0.20으로 입력", en: "Current and target weights; write 20% as 0.20 in the equations" } },
        { symbol: "dᵢ, uᵢ", meaning: { ko: "목표 대비 상대 드리프트와 평가수익률, %", en: "Relative target drift and unrealized return, in percent" } },
        { symbol: "C, sᵢ, S, F", meaning: { ko: "신규 투입금·종목 매도액·총 매도대금·매수 재원, 원 단위 정수", en: "New cash, position sale, total proceeds and buying budget, in whole KRW" } },
        { symbol: "floor(x)", meaning: { ko: "x를 넘지 않는 가장 큰 정수. 양수 금액의 원 미만을 버림", en: "The greatest integer no larger than x; discard fractional KRW for positive amounts" } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "가상 예시 · 총 보유액 1,000만원, 신규 투입 100만원, 이 종목 목표 20%", en: "Example · KRW 10m holdings, KRW 1m new cash, 20% target for this position" },
        nodes: [
          { label: { ko: "현재 300만원", en: "Current: KRW 3m" }, detail: { ko: "비중 30% · 원가 250만원", en: "30% weight · KRW 2.5m cost" } },
          { label: { ko: "69만원 매도", en: "Sell: KRW 690,000" }, detail: { ko: "드리프트 50% · 평가수익률 20%", en: "50% drift · 20% unrealized return" } },
          { label: { ko: "231만원 유지", en: "Retain: KRW 2.31m" }, detail: { ko: "1,100만원 × 20% × 105%", en: "KRW 11m × 20% × 105%" } },
        ],
      },
      example: {
        ko: "다른 매도가 없다면 매수 재원은 100만원 + 69만원 = 169만원입니다. 이 종목은 매도액이 양수이므로 같은 계산에서 다시 사지 않습니다. 반대로 새 돈이 충분해 계산된 매도액이 0원이면, 과대비중 조건에 걸렸다는 이유만으로 매수 대상에서 제외하지 않습니다.",
        en: "With no other sales, the buying budget is KRW 1m + KRW 690,000 = KRW 1.69m. This position has a positive sale amount, so it cannot be bought again in this calculation. If sufficient new cash instead makes the calculated sale zero, passing the overweight threshold alone does not exclude it from buying.",
      },
      caveat: {
        ko: "원가가 없거나 0원이면 수익 여부를 추정해 매도하지 않습니다. 손실 중인 목표 0% 종목도 보유합니다. 원 단위 내림 때문에 목표 0% 정리 후에도 1원 미만 평가액이 남을 수 있습니다. 세금·수수료·호가·최소 주문수량은 이 금액 계획에 포함되지 않습니다.",
        en: "A missing or zero cost basis never becomes an assumed gain. A losing position with a zero target is retained too. Whole-KRW rounding can leave a sub-KRW holding after a zero-target exit. Taxes, fees, execution prices and minimum order quantities are outside this amount plan.",
      },
    },
    {
      id: "ma120-effective-target",
      title: { ko: "2. MA120 아래에서는 목표액을 완만하게 낮춥니다", en: "2. Below MA120, reduce the effective target gradually" },
      lead: {
        ko: "추세 필터와 해당 종목 규칙이 켜진 경우에만 적용합니다. MA120은 확인된 최근 120개 가격 관측일의 종가 평균입니다. 가격이 평균 아래로 내려간 정도에 따라 목표액을 줄인 뒤 부족액을 다시 계산합니다. 최종 매수액에 일정 비율을 곱하는 방식이 아닙니다.",
        en: "This applies only when both the trend filter and the position's rule are enabled. MA120 is the average close across the latest 120 observed price dates. Reduce the target value according to how far price is below that average, then recalculate the shortfall. It is not a fixed percentage haircut on the final buy amount.",
      },
      equations: [
        {
          expression: "MA₁₂₀ = (P₁ + … + P₁₂₀) / 120",
          reading: {
            ko: "비교일 이후의 가격은 제외하고 최근 120개 관측값을 평균냅니다. 120일 달력에 빈 날짜를 채우는 방식은 아닙니다. 비교 가격과 과거 가격의 가격 기준도 확인합니다.",
            en: "Exclude observations after the comparison date and average the latest 120 observations. This is not a 120-calendar-day series filled across missing dates. The comparison price and history must also have an accepted price basis.",
          },
        },
        {
          expression: "gᵢ = max(0, 100 × (1 − Pᵢ / MA₁₂₀))",
          reading: {
            ko: "평균보다 아래인 비율을 양수 g로 표현합니다. 평균이 10,000원, 비교 가격이 9,850원이면 g는 1.5입니다. 평균 이상이거나 근거가 유효하지 않으면 감액하지 않습니다.",
            en: "Express the percentage below the average as a positive g. With an average of KRW 10,000 and a comparison price of KRW 9,850, g is 1.5. Prices at or above the average, or unavailable evidence, do not trigger a reduction.",
          },
        },
        {
          expression: "mᵢ = 1 − min(1, gᵢ / 3) × (1 − bᵢ)",
          reading: {
            ko: "평균 바로 아래에서는 1배에서 시작해 3% 아래까지 선형으로 낮춥니다. 3% 이상 아래에서는 분류별 하한 b를 유지합니다. 광범위 지수·배당 우량·기타 0.8배, 대형 성장 0.7배, 테마 0.5배입니다. 금·채권은 1배로 감액에서 제외합니다.",
            en: "Start at 1× just below the average and decrease linearly until price is 3% below it. At or below that point, retain the class floor b: 0.8× for broad indices, dividend quality and other assets; 0.7× for large growth; 0.5× for thematic assets. Gold and bonds remain at 1× and are exempt.",
          },
        },
        {
          expression: "Eᵢ = tᵢ × mᵢ × T,  Dᵢ = max(0, Eᵢ − pᵢ)",
          reading: {
            ko: "조정한 유효 목표액 E에서 이미 보유한 p를 빼면 부족액 D가 됩니다. 감액한 목표비중들을 다시 100%로 확대하지 않으므로, 필요에 따라 일부 재원이 현금으로 남습니다.",
            en: "Subtract the existing post-trim holding p from the effective target E to obtain shortfall D. Reduced target weights are not scaled back up to 100%, so part of the budget may remain as cash.",
          },
        },
      ],
      symbols: [
        { symbol: "P₁ … P₁₂₀, Pᵢ", meaning: { ko: "과거 120개 종가와 현재 비교 가격. 동일한 가격 단위 사용", en: "The 120 historical closes and current comparison price, in compatible price units" } },
        { symbol: "gᵢ", meaning: { ko: "MA120 아래 거리, % 단위 숫자. 1.5% 아래면 1.5", en: "Distance below MA120 in percent units; use 1.5 for 1.5% below" } },
        { symbol: "bᵢ, mᵢ", meaning: { ko: "자산 분류별 하한 배수와 실제 적용 배수, 단위 없음", en: "The class floor multiplier and the applied multiplier, dimensionless" } },
        { symbol: "Eᵢ, Dᵢ", meaning: { ko: "유효 목표액과 매수 부족액, 원화. 아직 원 미만을 버리지 않음", en: "Effective target value and buying shortfall, in KRW; fractional KRW are retained here" } },
      ],
      figure: {
        kind: "bars",
        caption: { ko: "대형 성장 자산의 목표액 배수 · 아래 거리에 따라 1배에서 0.7배로", en: "Large-growth target multiplier · from 1× to 0.7× with distance below MA120" },
        unit: { ko: "배", en: "×" },
        rows: [
          { label: { ko: "MA120 이상", en: "At or above MA120" }, value: 1 },
          { label: { ko: "1.5% 아래", en: "1.5% below" }, value: 0.85 },
          { label: { ko: "3% 이상 아래", en: "3% or more below" }, value: 0.7 },
        ],
      },
      example: {
        ko: "대형 성장 자산이 MA120보다 1.5% 아래라면 m = 1 − (1.5 ÷ 3) × (1 − 0.7) = 0.85입니다. 원래 목표액 200만원은 170만원으로 줄어듭니다. 매도 후 이미 160만원을 보유했다면 부족액은 10만원이며, 실제 매수액은 다음 단계에서 전체 재원과 다른 종목의 부족액에 따라 정해집니다.",
        en: "For large growth at 1.5% below MA120, m = 1 − (1.5 ÷ 3) × (1 − 0.7) = 0.85. An original KRW 2m target becomes KRW 1.7m. With KRW 1.6m already held after trimming, the shortfall is KRW 100,000. The next stage determines the actual buy using the total budget and other positions' shortfalls.",
      },
      caveat: {
        ko: "규칙이 꺼져 있거나 금·채권·적금·연금·주택청약·정기예금이면 배수는 1입니다. 관측이 120개보다 적거나 중복·잘못된 가격·허용되지 않은 가격 기준·오래되거나 미래인 비교 시세가 있으면 감액 근거로 쓰지 않습니다. 비교 시세 168시간 초과 또는 최신 과거 관측일 7일 초과도 제외합니다. 이 배수는 현재 구현된 정책값이며 미래 수익을 보장하거나 최적임을 입증한 값은 아닙니다.",
        en: "A disabled rule, gold, bonds, savings, pensions, housing subscriptions or fixed deposits use 1×. Fewer than 120 observations, duplicate or invalid history, unsupported price bases, and stale or future comparison quotes cannot justify a reduction. A comparison quote over 168 hours old or latest history over 7 calendar days old is also rejected. These are implemented policy parameters, not proven optimal values or guarantees of future returns.",
      },
    },
    {
      id: "whole-krw-allocation",
      title: { ko: "3. 부족액에 비례해 원 단위로 나눕니다", en: "3. Allocate whole KRW in proportion to shortfalls" },
      lead: {
        ko: "매도액이 0원이고 매수 가능한 종목만 후보가 됩니다. 후보별 유효 목표 부족액은 소수 원까지 비례 계산에 사용하되, 실제 배정액은 그 부족액을 내림한 금액을 넘을 수 없습니다. 작은 반올림 차이도 재원 합계가 맞도록 처리합니다.",
        en: "Only buyable positions with zero sale amounts are candidates. Keep fractional KRW in each effective-target shortfall for proportional weighting, but never allocate more than the shortfall rounded down. Whole-KRW rounding must preserve the budget totals.",
      },
      equations: [
        {
          expression: "D = ΣDᵢ,  Q = min(F, D)",
          reading: {
            ko: "매수 후보의 부족액 합 D와 재원 F 중 작은 쪽 Q까지만 배분합니다. 부족액 합이 0이면 매수도 0원입니다.",
            en: "Allocate at most Q, the smaller of candidate shortfalls D and available funds F. If total shortfall is zero, all buy amounts are zero.",
          },
        },
        {
          expression: "qᵢ = Q × Dᵢ / D,  capᵢ = floor(Dᵢ)",
          reading: {
            ko: "부족액 비중으로 이상적인 배분액 q를 구하고, 종목별 상한 cap은 부족액의 원 미만을 버려 정합니다.",
            en: "Compute ideal allocation q from each shortfall's share. The position cap is its shortfall rounded down to whole KRW.",
          },
        },
        {
          expression: "aᵢ = min(capᵢ, floor(qᵢ)),  R = floor(Q) − Σaᵢ",
          reading: {
            ko: "먼저 모두 내림합니다. 남은 R원은 q의 소수 부분이 큰 순서로, 상한에 여유가 있는 종목에 1원씩 한 차례 배정합니다. 소수 부분까지 같으면 고정된 배정 식별자 순으로 정하므로 같은 입력은 같은 결과를 냅니다.",
            en: "Round each allocation down first. Distribute the remaining R KRW in one pass, giving one KRW to each position with cap room in descending order of q's fractional remainder. Ties use the stable allocation identifier order, making identical inputs reproducible.",
          },
        },
        {
          expression: "L = F − Σaᵢ,  Σ(pᵢ + aᵢ) + L = V + C",
          reading: {
            ko: "배분 후 남은 금액 L은 현금입니다. 거래 후 보유액과 현금을 합하면 원래 보유액과 새 돈의 합이 됩니다. 재원이 충분해도 종목별 상한 때문에 남은 돈을 모두 투자하지 않을 수 있습니다.",
            en: "L is cash left after allocation. Post-trade holdings plus cash equal original holdings plus new cash. Position caps can leave money uninvested even when funds remain available.",
          },
        },
      ],
      symbols: [
        { symbol: "Dᵢ, D, Q", meaning: { ko: "종목별 부족액·부족액 합·배분 한도, 원화", en: "Position shortfall, total shortfall and deployment limit, in KRW" } },
        { symbol: "qᵢ, capᵢ, aᵢ", meaning: { ko: "이상적 배분액·원 단위 상한·실제 배정액. q만 소수 가능", en: "Ideal allocation, whole-KRW cap and assigned amount; only q may be fractional" } },
        { symbol: "R, L", meaning: { ko: "1원 추가 배정을 위한 잔여액과 최종 잔여 현금, 원 단위 정수", en: "Remainder for one-KRW awards and final cash left, in whole KRW" } },
      ],
      figure: {
        kind: "bars",
        caption: { ko: "가상 예시 · 재원 100원, 부족액 A 101원 / B 100원 / C 99원", en: "Example · KRW 100 budget; shortfalls A 101 / B 100 / C 99 KRW" },
        unit: { ko: "원", en: "KRW" },
        rows: [
          { label: { ko: "A · 나머지 1원 추가", en: "A · receives the remaining KRW 1" }, value: 34 },
          { label: { ko: "B", en: "B" }, value: 33 },
          { label: { ko: "C", en: "C" }, value: 33 },
        ],
      },
      example: {
        ko: "부족액 합 300원에서 이상적 배분은 약 33.6667원, 33.3333원, 33원입니다. 모두 33원씩 배정한 뒤 나머지 1원을 A에 주면 34 + 33 + 33 = 100원입니다. 상한의 예로, 재원 10원에 부족액이 0.8원과 2.2원뿐이면 상한은 0원과 2원입니다. 최종 매수는 0원과 2원이며 나머지 8원은 현금입니다.",
        en: "With a total shortfall of KRW 300, ideal amounts are approximately 33.6667, 33.3333 and 33 KRW. Allocate 33 each, then give the remaining KRW 1 to A: 34 + 33 + 33 = 100. For a cap example, a KRW 10 budget with only 0.8 and 2.2 KRW shortfalls has caps of 0 and 2. Final buys are 0 and 2 KRW, leaving KRW 8 in cash.",
      },
      caveat: {
        ko: "매도하지 않은 매수 불가 종목에 유효 부족액이 있으면 그 몫을 다른 종목에 몰아주지 않고 계산을 중단합니다. 최소 집행 기준은 ceil(F × 설정 비율 ÷ 100)이며 기본 비율은 85%입니다. ceil은 원 미만 올림입니다. 이 기준은 안내용이므로 충족시키려고 부족액 상한을 넘겨 강제로 매수하지 않습니다.",
        en: "If an untrimmed, non-buyable position has an effective shortfall, the calculation stops instead of sending its share elsewhere. The minimum-execution reference is ceil(F × configured percent ÷ 100), with an 85% default. Ceil rounds up to whole KRW. This is informational: it never forces buys above shortfall caps to meet that reference.",
      },
    },
    {
      id: "assumptions-and-baseline",
      title: { ko: "4. 내 가정은 기본 계산과 분리해 비교합니다", en: "4. Compare your assumptions separately from the baseline" },
      lead: {
        ko: "기본 결과를 보존한 채 신규 투입금의 일부를 현금으로 남기는 실험을 할 수 있습니다. 별도로 환율 변화 가정에 따른 현재 보유액 차이를 볼 수 있습니다. 현재 뉴스·금리·산업 전망을 자동 점수화해 매수액을 바꾸는 기능은 연결되어 있지 않습니다.",
        en: "Keep the baseline intact while testing a minimum cash reserve from your new contribution. Separately, inspect how an assumed exchange-rate change affects current holdings. News, interest rates and industry outlooks are not currently scored into automatic buy-amount adjustments.",
      },
      equations: [
        {
          expression: "nᵢ ≈ C × aᵢ / F,  nL ≈ C × L / F",
          reading: {
            ko: "섞인 재원의 각 매수액과 잔여 현금에 신규 투입금이 얼마나 포함되었는지 비례로 나눠 봅니다. 실제로는 원 단위 최대잔여 방식으로 나누므로 n들의 합은 C와 정확히 같습니다. 실제 돈의 출처를 추적한 기록이 아닌 비교용 귀속 규칙입니다.",
            en: "Attribute new cash proportionally to every baseline buy and to residual cash in the pooled budget. Actual attribution uses whole-KRW largest remainders, so the n amounts sum to C exactly. This is a comparison convention, not a record of where each unit of cash came from.",
          },
        },
        {
          expression: "H = floor(C × r / 100),  E = max(0, H − nL)",
          reading: {
            ko: "사용자가 정한 유보 비율 r로 신규 투입금의 최소 현금 목표 H를 구합니다. 이미 현금으로 남은 신규 투입분 nL을 먼저 인정하고 모자란 E만 추가 유보합니다. 실험을 끄면 추가 유보는 0원입니다.",
            en: "Use the chosen reserve percent r to obtain minimum new-cash reserve H. Credit the new cash already left uninvested, nL, before reserving only the missing E. With the experiment disabled, additional reserve is zero.",
          },
        },
        {
          expression: "Σeᵢ = E,  a′ᵢ = aᵢ − eᵢ,  L′ = L + E",
          reading: {
            ko: "추가 유보액은 각 매수의 신규 투입금 귀속분 n에 비례해 원 단위 최대잔여 방식으로 줄입니다. 각 감액 e는 n을 넘지 않습니다. 매도대금으로 귀속된 매수분과 원래 매도액은 유지하며 다른 종목에 재배분하지 않습니다.",
            en: "Reduce buys by E in proportion to their new-cash-attributed portions n, using whole-KRW largest remainders. Each reduction e is capped at n. Sale-funded buying and original sale amounts stay unchanged, with no redistribution to other positions.",
          },
        },
        {
          expression: "ΔFX = round(VUSD × h / 10,000)",
          reading: {
            ko: "별도 환율 실험은 달러 가격을 고정하고 현재 USD 표시 자산의 원화 평가액에 가정한 환율 변화율을 곱해 원 단위 반올림합니다. 이 값은 위의 매도·매수·유보 계산을 바꾸지 않습니다.",
            en: "The separate FX experiment holds dollar prices fixed, applies the assumed exchange-rate change to the current KRW value of USD-denominated assets, and rounds to whole KRW. It does not change the sale, buy or reserve calculations above.",
          },
        },
      ],
      symbols: [
        { symbol: "nᵢ, nL", meaning: { ko: "기본 매수와 기본 잔여 현금에 귀속된 신규 투입금, 원화", en: "New cash attributed to baseline buys and baseline residual cash, in KRW" } },
        { symbol: "r, H, E", meaning: { ko: "유보 비율(%), 신규 투입금 최소 현금 목표(원), 추가 유보액(원)", en: "Reserve percent, minimum new-cash reserve in KRW, and extra reserve in KRW" } },
        { symbol: "eᵢ, a′ᵢ, L′", meaning: { ko: "종목별 감액·가정 적용 후 매수액·가정 적용 후 현금, 원화", en: "Position reduction, scenario buy amount and scenario cash, in KRW" } },
        { symbol: "VUSD, h, ΔFX", meaning: { ko: "USD 표시 자산의 현재 원화 평가액, 환율 변화 가정(bp), 원화 평가액 차이. 100bp = 1%", en: "Current KRW value of USD-denominated assets, assumed FX move in basis points, and KRW value difference; 100 bp = 1%" } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "가상 예시 · 새 돈 100만원 + 매도대금 50만원, 신규 투입금 50% 유보", en: "Example · KRW 1m new cash + KRW 500,000 proceeds, with a 50% new-cash reserve" },
        nodes: [
          { label: { ko: "기본 결과", en: "Baseline" }, detail: { ko: "매수 120만원 · 현금 30만원", en: "Buy KRW 1.2m · cash KRW 300,000" } },
          { label: { ko: "기존 현금 인정", en: "Credit existing cash" }, detail: { ko: "현금 중 신규 투입분 20만원", en: "KRW 200,000 cash attributed to new money" } },
          { label: { ko: "추가 30만원 유보", en: "Reserve another KRW 300,000" }, detail: { ko: "신규 투입금 현금 목표 50만원", en: "KRW 500,000 new-cash reserve target" } },
          { label: { ko: "가정 결과", en: "Scenario" }, detail: { ko: "매수 90만원 · 현금 60만원", en: "Buy KRW 900,000 · cash KRW 600,000" } },
        ],
      },
      example: {
        ko: "위 예시에서 기본 매수 120만원 중 신규 투입금 귀속분은 80만원, 매도대금 귀속분은 40만원입니다. 30만원을 추가 유보하면 신규 투입분 매수만 50만원으로 줄어 총 매수는 90만원이 됩니다. 별개의 환율 예로, 현재 USD 표시 자산이 원화 100만원이고 환율을 +5%(500bp)로 가정하면 달러 가격 고정 시 원화 평가액 차이는 +5만원입니다.",
        en: "In this example, KRW 800,000 of baseline buys is attributed to new cash and KRW 400,000 to sale proceeds. Reserving another KRW 300,000 reduces only new-cash-funded buys to KRW 500,000, leaving total buys of KRW 900,000. As a separate FX example, USD-denominated holdings worth KRW 1m gain KRW 50,000 under an assumed +5% FX move (500 bp), with dollar prices fixed.",
      },
      caveat: {
        ko: "현금 유보 실험은 기본적으로 꺼져 있으며, 저장된 목표비중이나 기본 계산을 덮어쓰지 않습니다. 환율 실험의 범위는 ±20%이며 USD 표시 현재 보유액만 다룹니다. 원화 상장 해외 ETF의 내재 환노출·환헤지·파생상품·매수 후 포트폴리오는 반영하지 않으므로 전체 환위험 수치가 아닙니다. 금리·뉴스 원문 링크와 과거 환율 구간은 참고 정보이며 예측 또는 자동 조정 신호가 아닙니다.",
        en: "The cash-reserve experiment is off by default and does not overwrite saved targets or the baseline. The FX experiment spans ±20% and covers only current USD-denominated holdings. It excludes embedded currency exposure in KRW-listed overseas ETFs, hedges, derivatives and the post-buy portfolio, so it is not total currency risk. Rate/news source links and historical FX ranges are context, not forecasts or automatic adjustment signals.",
      },
    },
  ],
} satisfies MethodGuide;
