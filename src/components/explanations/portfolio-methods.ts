import type { MethodGuide } from "./method-types";

const c = (ko: string, en: string) => ({ ko, en });

// Authority: portfolio-math.ts calculateFxAwarePositionMovementKrw /
// calculateFxAwareSnapshotMovementKrw; portfolio-movement.ts admission and reconciliation.
export const movementMethod = {
  title: c("가격·환율·순매매를 분리하는 법", "Separating price, FX and net trades"),
  intro: c("평가액의 증가가 모두 투자 수익은 아닙니다. 같은 기준과 현재를 비교하고, 새로 산 금액을 분리한 뒤 가격과 환율의 기여를 나눕니다.", "An increase in market value is not all investment profit. Compare a consistent baseline with the present, remove net purchases, then attribute the remaining change to price and FX."),
  sections: [
    {
      id: "price-fx", title: c("수량이 그대로일 때: 교차항까지 정확히 분해", "Unchanged quantity: account for the cross term"),
      lead: c("먼저 기준 환율을 고정해 가격 변화만 계산하고, 그다음 현재 가격에 환율 변화를 적용합니다. 계산 순서를 이렇게 고정하면 가격과 환율의 교차 효과를 중복하거나 빠뜨리지 않습니다.", "First hold baseline FX constant to measure the price move; then apply the FX move at the current price. This ordered decomposition assigns the price–FX interaction exactly once."),
      equations: [
        { expression: "V₀ = q p₀ f₀,   V₁ = q p₁ f₁", reading: c("가격을 원화로 환산한 뒤 수량을 곱한 평가액입니다.", "Multiply quantity by the unit price converted to KRW.") },
        { expression: "ΔV = q(p₁ − p₀)f₀ + qp₁(f₁ − f₀)", reading: c("첫 항이 가격 영향, 둘째 항이 환율 영향입니다. 두 항의 합이 평가액 차이와 일치합니다.", "The first term is price impact and the second is FX impact. Together they equal the value change.") },
        { expression: "rKRW = (1 + rprice)(1 + rFX) − 1", reading: c("원화 수익률에는 rprice × rFX 교차항이 있습니다. 이 서비스에서는 그 교차항이 환율 영향에 포함됩니다.", "The KRW return includes the rprice × rFX cross term, assigned to FX impact in this decomposition.") },
      ],
      symbols: [
        { symbol: "q", meaning: c("동일하게 유지된 보유 수량", "Unchanged holding quantity") },
        { symbol: "p₀, p₁", meaning: c("기준·현재 단가, 해당 종목 표시 통화", "Baseline and current unit prices in the instrument currency") },
        { symbol: "f₀, f₁", meaning: c("기준·현재 환율, 표시 통화 1단위당 원화. KRW 종목은 1", "Baseline and current KRW per currency unit; 1 for KRW instruments") },
        { symbol: "rprice, rFX", meaning: c("p₁/p₀−1, f₁/f₀−1 (소수)", "p₁/p₀−1 and f₁/f₀−1, as decimals") },
      ],
      figure: { kind: "bars", caption: c("검산 예시 · 1주, 가격 100→103, 환율 1,000→1,010", "Worked example · 1 unit, price 100→103, FX 1,000→1,010"), unit: c("원", "KRW"), rows: [{ label: c("가격 영향", "Price"), value: 3000 }, { label: c("환율 영향", "FX"), value: 1030 }, { label: c("전체 변동", "Total"), value: 4030 }] },
      example: c("기준 100,000원 → 현재 104,030원. 가격은 +3%, 환율은 +1%지만 원화 변동은 +4.03%입니다. 3,000 + 1,030 = 4,030원으로 검산됩니다.", "Baseline ₩100,000 → current ₩104,030. Price rises 3% and FX 1%, producing a 4.03% KRW change. ₩3,000 + ₩1,030 = ₩4,030."),
      caveat: c("종목의 현지 가격 등락률과 계좌의 원화 변동률은 다른 지표입니다. 07:00 기록 경계나 장 전이라는 이유만으로 0을 넣지 않습니다. 같은 가격·환율이 들어오면 식의 결과가 자연스럽게 0이 됩니다.", "A holding’s local-price return differs from its KRW value change. The 07:00 service boundary or pre-market time does not force a zero; identical prices and FX naturally yield zero."),
    },
    {
      id: "trades", title: c("중간에 매매가 있으면: 매매대금과 이후 손익 분리", "With intervening trades: separate funding and subsequent profit"),
      lead: c("현재 평가액에서 과거 평가액과 순매매대금을 빼야 자금 유입을 성과로 오해하지 않습니다. 각 매매 물량의 가격·환율 변화는 그 거래 시점부터 계산합니다.", "Subtract baseline value and net trade funding from current value so inflows are not mistaken for profit. Measure each traded quantity’s subsequent price and FX changes from its execution point."),
      equations: [
        { expression: "F = Σⱼ Δqⱼ pⱼ fⱼ,   q₁ = q₀ + Σⱼ Δqⱼ", reading: c("매수 수량은 양수, 매도 수량은 음수입니다. F는 투자자산으로 들어온 순매매 금액입니다.", "Bought quantities are positive and sold quantities negative. F is net trade funding into invested assets.") },
        { expression: "M = V₁ − V₀ − F", reading: c("오늘 변동 M은 순매매를 뺀 금액 변화입니다. 현재 비교 평가액은 V₀ + F + M입니다.", "Today’s movement M excludes net trades. Comparable current value reconciles to V₀ + F + M.") },
        { expression: "P = q₀(p₁ − p₀)f₀\n+ Σⱼ Δqⱼ(p₁ − pⱼ)fⱼ", reading: c("기존 물량과 거래 물량 각각의 가격 영향입니다.", "Price impact from the initial quantity and each signed trade leg.") },
        { expression: "X = q₀p₁(f₁ − f₀)\n+ Σⱼ Δqⱼp₁(f₁ − fⱼ)\nM = P + X", reading: c("같은 거래 근거로 환율 영향을 구하고, 실제 금액 변화와 합계를 맞춥니다.", "Use those same trade legs for FX attribution and reconcile their sum with observed movement.") },
      ],
      symbols: [{ symbol: "Δqⱼ, pⱼ, fⱼ", meaning: c("거래 j의 부호 있는 수량·거래 단가·환율", "Signed quantity, execution price and FX for trade j") }, { symbol: "V, F, M, P, X", meaning: c("모두 원화 금액. 평가액·순매매·오늘 변동·가격 영향·환율 영향", "All in KRW: value, net funding, movement, price impact and FX impact") }],
      figure: { kind: "flow", caption: c("검산 예시 · 기준 2주에서 1주 추가 매수", "Worked example · add 1 unit to an initial 2"), nodes: [{ label: c("기준 200,000원", "Baseline ₩200,000"), detail: c("2 × 100 × 1,000", "2 × 100 × 1,000") }, { label: c("순매수 102,000원", "Net purchase ₩102,000"), detail: c("1 × 102 × 1,000", "1 × 102 × 1,000") }, { label: c("현재 312,090원", "Current ₩312,090"), detail: c("3 × 103 × 1,010", "3 × 103 × 1,010") }] },
      example: c("312,090 − 200,000 − 102,000 = 10,090원. 가격 영향 7,000원 + 환율 영향 3,090원으로 일치합니다. 추가 매수한 102,000원은 수익이 아닙니다.", "₩312,090 − ₩200,000 − ₩102,000 = ₩10,090, equal to ₩7,000 price impact + ₩3,090 FX impact. The ₩102,000 purchase is not profit."),
      caveat: c("위 식은 거래·수량·평가액이 대사되는 경우입니다. 근거가 빠지거나 합계가 맞지 않으면 가격·환율 분해를 보류합니다. 수량 정정을 실제 매매로 꾸미지 않습니다. 미지원 통화나 오래된 가격은 제외 근거를 따릅니다.", "These equations apply when trades, quantities and valuations reconcile. Missing or inconsistent evidence withholds attribution. A quantity correction is not fabricated into a trade. Unsupported currencies and stale prices follow the displayed exclusions."),
    },
  ],
} satisfies MethodGuide;

// Authority: portfolio-risk.ts; portfolio-risk-statistics.ts;
// portfolio-risk-derived-metrics.ts; portfolio-risk-path-analytics.ts.
export const riskMethod = {
  title: c("상관·위험 기여·Sharpe의 수학", "The mathematics of correlation, risk contribution and Sharpe"),
  intro: c("같은 날짜로 맞춘 종목별 원화 단순수익률과 현재 비중으로 계산합니다. 현재 구성의 통계적 성질이며, 과거의 실제 매매를 복원한 성과와는 구분합니다.", "Calculations use aligned KRW simple returns and current weights. They describe the current composition’s statistical properties, separately from performance reconstructed from actual historical trades."),
  sections: [
    {
      id: "covariance", title: c("공분산에서 포트폴리오 변동성까지", "From covariance to portfolio volatility"),
      lead: c("각 종목의 흔들림뿐 아니라 같은 날 얼마나 함께 움직였는지를 계산합니다. 단순히 종목별 변동성의 평균을 내면 공분산 항을 빠뜨립니다.", "Measure not only each holding’s fluctuations but how they move together on the same dates. Averaging standalone volatilities omits covariance terms."),
      equations: [
        { expression: "μᵢ = (1/n) Σₜ rᵢ,ₜ\nΣᵢⱼ = Σₜ (rᵢ,ₜ − μᵢ)(rⱼ,ₜ − μⱼ) / (n − 1)", reading: c("n−1로 나누는 표본 공분산입니다. Σ의 대각 원소는 각 종목의 분산입니다.", "Sample covariance divides by n−1. The diagonal entries of Σ are individual variances.") },
        { expression: "rₚ,ₜ = Σᵢ wᵢ rᵢ,ₜ\nσₚ = √(wᵀΣw),   σannual = √252 × σₚ", reading: c("비중은 계산 대상 안에서 합계 1로 정규화합니다. 일반 위험 화면은 연간 252개 관측을 가정합니다.", "Weights sum to one within the included universe. The general risk view annualizes using 252 observations per year.") },
        { expression: "ρᵢⱼ = Σᵢⱼ / (σᵢσⱼ)\nρweighted = Σᵢ<ⱼ wᵢwⱼρᵢⱼ / Σᵢ<ⱼ wᵢwⱼ", reading: c("평균 상관은 자기 자신을 제외한 종목 쌍을 비중의 곱으로 가중합니다. 하락 구간 상관은 rₚ,ₜ < 0인 관측만 추린 뒤 같은 식을 다시 계산합니다.", "Average correlation weights distinct pairs by the product of their weights. Down-market correlation recomputes the same statistics only where rₚ,ₜ < 0.") },
      ],
      symbols: [{ symbol: "rᵢ,ₜ; n", meaning: c("종목 i의 시점 t 원화 단순수익률; 공통 관측 수", "Instrument i’s KRW simple return at observation t; aligned observation count") }, { symbol: "w; Σ; σ; ρ", meaning: c("현재 비중 벡터; 표본 공분산 행렬; 표준편차; 상관계수", "Current weight vector; sample covariance matrix; standard deviation; correlation") }],
      figure: { kind: "bars", caption: c("검산 예시 · 비중 각 50%, 연변동성 10%와 20%, 상관 0", "Worked example · 50/50 weights, annual volatilities 10% and 20%, zero correlation"), unit: c("%", "%"), rows: [{ label: c("자산 A", "Asset A"), value: 10 }, { label: c("자산 B", "Asset B"), value: 20 }, { label: c("전체", "Portfolio"), value: 11.18 }] },
      example: c("연변동성 = √(0.5²×0.1² + 0.5²×0.2²) ≈ 11.18%. 두 자산 변동성의 단순 평균 15%와 다릅니다. 상관이 1이면 같은 조건에서 15%가 됩니다.", "Annual volatility = √(0.5²×0.1² + 0.5²×0.2²) ≈ 11.18%, versus a simple average of 15%. With correlation 1, the portfolio volatility becomes 15%."),
      caveat: c("분산이 0인 종목의 상관, 부족한 하락일 표본은 0으로 대체하지 않습니다. 현재 비중으로 만든 고정 비중 일간 수익률은 시뮬레이션의 최초 비중·계속 보유 경로와 같지 않습니다. 과거 상관은 위기에도 유지된다는 보장이 없습니다.", "Undefined correlations for zero-variance instruments and insufficient down-day samples are not replaced by zero. This current-weight daily series differs from simulation’s initial-weight buy-and-hold paths. Historical correlations need not persist through a crisis."),
    },
    {
      id: "risk-share", title: c("위험 기여와 유효 분산 수 ENB", "Risk contribution and effective number of bets"),
      lead: c("비중이 작아도 변동성이 크거나 다른 자산과 강하게 동반하면 전체 위험 기여가 클 수 있습니다. 여기의 ENB는 금액 비중이 아니라 절대 위험 기여도의 집중도로 정의합니다.", "A small holding can contribute substantial risk if it is volatile or moves strongly with other holdings. This ENB is defined by concentration of absolute risk contributions, not capital weights."),
      equations: [
        { expression: "MRCᵢ = (Σw)ᵢ / σₚ\nRCᵢ = wᵢ MRCᵢ,   Σᵢ RCᵢ = σₚ", reading: c("MRC는 비중 변화에 대한 변동성의 한계 변화, RC는 해당 비중의 부호 있는 기여입니다. 상쇄 역할을 하는 자산은 음수가 될 수 있습니다.", "MRC is volatility’s marginal sensitivity to a weight; RC is the signed contribution at that weight. A hedging contribution can be negative.") },
        { expression: "sᵢ = |RCᵢ| / Σⱼ |RCⱼ|\nENB = 1 / Σᵢ sᵢ²", reading: c("기여의 절댓값을 합계 1로 맞추고 집중도의 역수를 구합니다. 부호 있는 기여율과 절대 위험 점유율은 구분됩니다.", "Normalize absolute contributions to sum to one, then invert their concentration. Signed contribution percentages differ from absolute risk shares.") },
      ],
      symbols: [{ symbol: "RCᵢ; sᵢ", meaning: c("일간 변동성에 대한 기여; 합계 1인 절대 위험 점유율", "Contribution to daily volatility; absolute risk share summing to one") }, { symbol: "ENB", meaning: c("이 구현의 위험 기여 집중도 역수. 실제 독립 자산 수는 아님", "This implementation’s inverse risk-contribution concentration; not a literal count of independent assets") }],
      figure: { kind: "bars", caption: c("검산 예시 · 두 자산이 위험의 80%·20%를 차지", "Worked example · two assets account for 80% and 20% of absolute risk"), unit: c("%", "%"), rows: [{ label: c("자산 A", "Asset A"), value: 80 }, { label: c("자산 B", "Asset B"), value: 20 }] },
      example: c("ENB = 1/(0.8² + 0.2²) ≈ 1.47. 위험 기여가 50%·50%로 같으면 2입니다. 종목을 두 개 보유했다는 사실만으로 2가 되지는 않습니다.", "ENB = 1/(0.8² + 0.2²) ≈ 1.47. Equal 50/50 risk contributions give 2. Holding two instruments alone does not imply an ENB of 2."),
      caveat: c("전체 변동성이 사실상 0이거나 유효한 기여를 구할 수 없으면 ENB는 비어 있습니다. 이 정의는 고유요인 기반 분산도와 다르며, ENB가 커도 손실 가능성이 사라지지 않습니다.", "ENB is unavailable when portfolio volatility is effectively zero or valid contributions cannot be formed. This definition differs from eigenfactor diversification; a higher ENB does not remove loss risk."),
    },
    {
      id: "sharpe-beta", title: c("Sharpe와 베타: 서로 다른 질문", "Sharpe and beta answer different questions"),
      lead: c("Sharpe는 변동성 대비 평균 초과수익, 베타는 기준지수와의 공동 움직임을 측정합니다. 둘 다 과거 표본의 추정치입니다.", "Sharpe measures average excess return relative to volatility; beta measures co-movement with a benchmark. Both are estimates from historical samples."),
      equations: [
        { expression: "rf,d = (1 + rf,a)^(1/252) − 1\nSharpe = √252 × (mean(rₚ) − rf,d) / sd(rₚ)", reading: c("일간 산술평균과 표본 표준편차를 사용합니다. 이 위험 화면의 기본 무위험 수익률 가정은 연 0%이며 현재 시장 금리를 자동 반영한 값이 아닙니다.", "Uses the arithmetic daily mean and sample standard deviation. This risk view defaults to an annual risk-free rate of 0%, not an automatically fetched market rate.") },
        { expression: "β = Cov(rₚ, rb) / Var(rb)", reading: c("포트폴리오와 기준지수의 공통 날짜만 맞춰 표본 공분산과 분산을 계산합니다.", "Compute sample covariance and benchmark variance only on their common dates.") },
      ],
      symbols: [{ symbol: "rf,a; rf,d", meaning: c("연간·일간 무위험 수익률 (소수)", "Annual and daily risk-free return, as decimals") }, { symbol: "rb; β", meaning: c("기준지수 수익률; 기준지수에 대한 회귀 기울기", "Benchmark return; regression slope with respect to the benchmark") }],
      figure: { kind: "flow", caption: c("변동성 대비 보상과 지수 민감도", "Reward relative to volatility and benchmark sensitivity"), nodes: [{ label: c("날짜 정렬", "Align dates"), detail: c("베타는 지수와 공통 날짜만 사용", "Beta uses dates shared with its benchmark") }, { label: c("Sharpe", "Sharpe"), detail: c("초과수익 ÷ 내 변동성", "Excess return ÷ own volatility") }, { label: c("베타", "Beta"), detail: c("공분산 ÷ 기준지수 분산", "Covariance ÷ benchmark variance") }] },
      example: c("일평균 0.1%, 일표준편차 1%, 무위험 0%라면 Sharpe ≈ √252×0.001/0.01 = 1.59. 공분산 0.00012, 지수 분산 0.0001이면 베타는 1.2입니다.", "A daily mean of 0.1%, daily standard deviation of 1% and zero risk-free rate give Sharpe ≈ √252×0.001/0.01 = 1.59. Covariance 0.00012 and benchmark variance 0.0001 give beta 1.2."),
      caveat: c("베타 1.2는 다음 번 지수가 1% 오를 때 반드시 1.2% 오른다는 뜻이 아닙니다. 표본 부족·분모 0이면 결과는 비어 있습니다. √252 연환산은 통계적 관례이며 자기상관이나 비정상 시장에서 정확한 미래 위험을 보장하지 않습니다.", "Beta 1.2 does not guarantee a 1.2% gain when the benchmark next rises 1%. Insufficient samples or zero denominators leave results unavailable. √252 annualization is a statistical convention, not a guarantee of future risk under serial dependence or changing markets."),
    },
  ],
} satisfies MethodGuide;
