import type { MethodGuide } from "./method-types";

// Display data only. Calculation authorities:
// lib/simulation-economic-state-model.ts; simulation-owner-economic-research.ts;
// simulation-owner-economic-candidates.ts; simulation-owner-outcome-optimizer.ts;
// simulation-owner-economic-validation.ts; simulation-nav-path-summary.ts.
// No engine import or market request belongs in this client explanation.
export const economicSimulationMethod = {
  title: { ko: "경제상태 모형의 수식과 계산 과정", en: "Economic-state model: formulas and methods" },
  intro: {
    ko: "경제 상태에 따라 평균 움직임을 조정하되, 흔들림과 종목 민감도는 같은 학습 구간에서 추정해 고정합니다. 아래는 연결된 모형의 계산 규칙입니다. 그림의 숫자는 검산용 가상 예시이며 내 포트폴리오 결과가 아닙니다.",
    en: "Adjust the mean movement as economic states evolve, while keeping uncertainty and asset sensitivities fixed from the same fitted window. These are the connected model's calculation rules. Figures use hypothetical worked examples, not your portfolio results.",
  },
  sections: [
    {
      id: "economic-state-mean",
      title: { ko: "1. 비슷한 경제 상태로 평균을 조정합니다", en: "1. Condition the mean on similar economic states" },
      lead: {
        ko: "최근 90개 공통 원화 수익률 구간 중 경제 자료까지 함께 맞는 45개 이상을 사용합니다. 상태는 USD/KRW의 로그 수준, 미국 10년 금리, 미국 10년−2년 금리차입니다. 가격 등락과 환율을 이미 합친 원화 수익률이 종목의 학습 대상입니다.",
        en: "Use at least 45 factor-matched observations within the latest 90 common KRW-return intervals. State comprises the log USD/KRW level, the US 10-year yield and the US 10-year minus 2-year yield spread. Asset fitting uses KRW returns that already combine price and FX movements.",
      },
      equations: [
        {
          expression: "xₜ = [log(FXₜ), Y10ₜ, Curveₜ],  fₜ = xₜ₊₁ − xₜ",
          reading: {
            ko: "상태 수준 x와 그 다음 구간의 변화 f를 연결합니다. 환율은 로그 차이, 금리와 금리차는 %포인트 차이입니다. 금리 4.0%→4.1%는 이 식에서 +0.1이며 +2.5% 수익률로 바꾸지 않습니다.",
            en: "Pair state level x with its following change f. FX uses a log difference; yield and spread use percentage-point differences. A yield move from 4.0% to 4.1% is +0.1 here, not a +2.5% investment return.",
          },
        },
        {
          expression: "yᵢ,ₜ = log(1 + rKRWᵢ,ₜ),  ωₜ = 0.97ⁿ⁻¹⁻ᵗ / Σⱼ0.97ⁿ⁻¹⁻ʲ",
          reading: {
            ko: "원화 단순수익률을 로그수익률 y로 바꿉니다. 오래된 관측일수록 가중치가 0.97배씩 작아지도록 정규화한 ω로 평균과 공분산을 추정합니다. 관측이 없는 날짜를 끼워 넣지 않습니다.",
            en: "Convert KRW simple return into log return y. Normalize weights ω so each older observation receives a factor of 0.97 less weight when estimating means and covariances. Missing dates are not inserted.",
          },
        },
        {
          expression: "sⱼ = 1.4826 × median(|xₜ,ⱼ − median(x·,ⱼ)|)",
          reading: {
            ko: "각 상태 변수의 흔한 변동 규모 s를 중앙절대편차로 구합니다. 환율과 금리의 단위가 다른 탓에 한 변수만 거리를 지배하지 않게 합니다. 이 규모가 너무 작으면 표본표준편차와 양수 하한을 순서대로 사용합니다.",
            en: "Estimate each state feature's typical scale s using median absolute deviation. This prevents differing FX and yield units from dominating distance. A degenerate scale falls back to sample standard deviation and then a positive floor.",
          },
        },
        {
          expression: "dₜ(x)² = (1/3) Σⱼ((xⱼ − xₜ,ⱼ) / sⱼ)²",
          reading: {
            ko: "현재 모의 상태와 각 과거 상태의 차이를 규모로 나눈 뒤 세 변수의 제곱 평균을 구합니다. d는 그 제곱근입니다. 매 경로의 매 단계에서 누적된 상태로 거리를 다시 구합니다.",
            en: "Scale the difference between the current simulated state and each historical state, then average the three squared differences. d is its square root. Distances are recalculated at every path step from the accumulated simulated state.",
          },
        },
        {
          expression: "aₜ(x) = ωₜe^(−dₜ²/2) / Σⱼωⱼe^(−dⱼ²/2),  ESS = 1 / Σₜaₜ²",
          reading: {
            ko: "가까운 과거와 최근 관측에 더 큰 가중치를 줍니다. ESS는 가중치가 몇 관측에 실질적으로 퍼졌는지 나타냅니다. 한 관측에 몰리면 약 1, 여러 관측에 고르게 퍼지면 커집니다.",
            en: "Give more weight to nearby states and recent observations. ESS measures the effective number of observations carrying that weight. Concentration on one observation gives about 1; spreading weight across observations raises it.",
          },
        },
        {
          expression: "b(x) = 0.5 × clamp((ESS − 1)/19, 0, 1) × e^(−0.5(dmin/2)²)",
          reading: {
            ko: "지역 평균의 반영 비율 b는 최대 0.5입니다. 유효 관측이 적거나 가장 가까운 과거조차 멀면 반영 비율을 낮춥니다. clamp는 값을 0과 1 사이로 제한합니다. 최근접 거리 2 초과는 과거 범위 밖으로 나간 단계의 진단 기준입니다.",
            en: "The local-mean blend b is capped at 0.5. It fades when effective evidence is sparse or even the nearest historical state is distant. Clamp bounds its input between 0 and 1. Nearest distance above 2 flags an extrapolated step for diagnostics.",
          },
        },
        {
          expression: "μF(x) = (1 − b(x))μF,global + b(x)Σₜaₜ(x)fₜ",
          reading: {
            ko: "전체 가중 평균과 유사 상태의 다음 변화 평균을 섞습니다. 평균만 상태에 따라 달라지고, 다음 단계에서 설명하는 공분산·민감도는 경로를 시작할 때 추정한 값을 유지합니다.",
            en: "Blend the global weighted mean with the mean following change of similar states. Only this mean changes with state. Covariances and sensitivities described next remain fixed at their initial fitted values.",
          },
        },
      ],
      symbols: [
        { symbol: "x, f, y", meaning: { ko: "경제 수준 벡터, 다음 구간의 경제 변화 벡터, 종목 원화 로그수익률", en: "Economic level vector, following economic-change vector, and asset KRW log return" } },
        { symbol: "t, j, n", meaning: { ko: "과거 관측 순서, 세 상태 변수의 인덱스, 공동 관측 개수", en: "Historical observation index, index of the three state features, and matched observation count" } },
        { symbol: "ω, a, ESS", meaning: { ko: "최근성 가중치, 유사 상태 가중치, 유효 관측 수", en: "Recency weights, similar-state weights, and effective observation count" } },
        { symbol: "s, dmin, b", meaning: { ko: "상태별 규모, 표준화 최근접 거리, 지역 평균 반영 비율", en: "Feature scales, standardized nearest-state distance, and local-mean blend" } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "같은 계산을 매 단계 반복 · 흔들림의 크기를 새로 학습하는 과정은 아닙니다", en: "Repeat each step · this does not refit the size of uncertainty" },
        nodes: [
          { label: { ko: "누적 경제 상태", en: "Accumulated state" }, detail: { ko: "로그 환율 · 금리 · 금리차", en: "Log FX · yield · spread" } },
          { label: { ko: "과거와 거리 비교", en: "Distance to history" }, detail: { ko: "가중치와 ESS · 먼 상태는 약화", en: "Weights and ESS · fade at distance" } },
          { label: { ko: "다음 변화의 평균", en: "Mean next change" }, detail: { ko: "지역 반영 최대 50%", en: "At most 50% local blend" } },
        ],
      },
      example: {
        ko: "ESS가 20이고 최근접 거리가 0이면 b는 0.5입니다. 한 요인의 전체 평균 변화가 +0.0001, 유사 상태 평균이 −0.0003이라면 혼합 평균은 −0.0001입니다. 이것은 평균의 계산일 뿐이며 실제 생성되는 변화에는 다음 단계의 무작위 충격이 추가됩니다.",
        en: "With ESS 20 and nearest distance 0, b is 0.5. If one factor's global mean change is +0.0001 and its local mean is −0.0003, the blended mean is −0.0001. This computes only a mean; generated changes also contain the random shocks described next.",
      },
      caveat: {
        ko: "경제 자료는 상태 기준일보다 먼저 공개되어야 하고 공표일·관측일·관측기간 말일 중 가장 오래된 날짜가 7일을 넘으면 제외합니다. 이력 밖의 상태에서 조정을 약화해도 미래가 정확해지는 것은 아닙니다. 세 상태 변수 외에 기업 실적·산업·각국 정책금리·뉴스를 직접 분석하지 않습니다. 공표 시각과 수정본의 완전한 과거 보존도 보장되지 않습니다.",
        en: "Factor data must be released strictly before the state date; the oldest release, factor or period-end date cannot be over seven days old. Fading adjustments outside history does not establish forecasting accuracy. Beyond the three state variables, earnings, industries, countries' policy rates and news are not directly analyzed. Complete historical publication timestamps and revision vintages are not guaranteed either.",
      },
    },
    {
      id: "factor-and-residual-shocks",
      title: { ko: "2. 공통 충격과 종목별 차이로 경로를 만듭니다", en: "2. Generate paths from common and residual shocks" },
      lead: {
        ko: "종목의 원화 로그수익률을 경제 요인 변화로 설명하고, 설명되지 않는 부분은 잔차로 남깁니다. 요인끼리의 상관뿐 아니라 잔차의 종목 간 상관도 보존합니다. 추정한 평균 회귀계수와 두 공분산은 한 번 학습한 뒤 모든 경로에서 고정합니다.",
        en: "Explain asset KRW log returns using economic-factor changes and retain unexplained movements as residuals. Preserve correlations between factors and between assets' residuals. Regression coefficients and both covariances are fitted once and held fixed across paths.",
      },
      equations: [
        {
          expression: "μz = Σₜωₜzₜ,  C(z) = Σₜωₜ(zₜ−μz)(zₜ−μz)ᵀ / (1−Σₜωₜ²)",
          reading: {
            ko: "최근성 가중 평균과, 가중치 집중도를 보정한 공분산을 구합니다. 공분산의 대각선은 각 변수의 분산이며 비대각선은 변수들이 함께 움직이는 정도입니다.",
            en: "Compute the recency-weighted mean and covariance corrected for weight concentration. Diagonal covariance entries are individual variances; off-diagonal entries describe co-movement.",
          },
        },
        {
          expression: "ΣF = 0.85 C(f) + 0.15 diag(C(f)),  λ = max(maxⱼΣFⱼⱼ, 10⁻¹²) × 10⁻⁶",
          reading: {
            ko: "요인 공분산은 대각선을 유지하고 비대각선만 15% 줄입니다. 회귀 계산에는 작은 λ를 대각선에 더해 거의 같은 움직임의 요인 때문에 계산이 불안정해지는 것을 완화합니다. 투자 수익을 올리는 추가 항이 아닙니다.",
            en: "Keep factor variances unchanged while shrinking off-diagonal covariances by 15%. Add a small λ to the regression diagonal to stabilize nearly collinear factors. This numerical regularization is not an extra source of investment return.",
          },
        },
        {
          expression: "β = C(y,f)(ΣF + λI)⁻¹,  α = μy − βμF,global",
          reading: {
            ko: "중심을 맞춘 종목·요인 교차공분산으로 민감도 β를 추정합니다. 절편 α는 종목 평균에서 요인 평균의 영향을 빼서 정합니다. 요인의 평균을 두 번 더하지 않도록 분리한 식입니다.",
            en: "Estimate sensitivities β from centered asset–factor cross-covariance. Set intercept α by subtracting the factor-mean contribution from the asset mean. This separates the intercept without counting factor means twice.",
          },
        },
        {
          expression: "εₜ = yₜ − α − βfₜ,  ΣE = 0.75 C(ε−με) + 0.25 diag(C(ε−με))",
          reading: {
            ko: "회귀가 설명하지 못한 잔차를 다시 중심화합니다. 잔차 공분산도 대각선은 유지하고 비대각선을 25% 줄입니다. 종목별 잔차를 서로 완전히 독립이라고 놓지 않습니다.",
            en: "Recenter the residuals left unexplained by regression. Keep their variances but shrink off-diagonal covariances by 25%. Assets' residual movements are not assumed to be fully independent.",
          },
        },
        {
          expression: "f* = μF(x) + LF zF √((7−2)/U),  U ~ χ²₇,  zF ~ N(0,I)",
          reading: {
            ko: "LF LFᵀ=ΣF인 행렬로 동반 충격을 만듭니다. 자유도 7의 Student-t 충격에 √((7−2)/U)를 사용해 공분산 규모를 맞춥니다. 같은 단계의 요인들이 하나의 U를 공유하며, 평균은 현재 모의 상태에서 다시 구한 값을 씁니다.",
            en: "Use a matrix satisfying LF LFᵀ=ΣF to create correlated shocks. The factor √((7−2)/U) scales the seven-degree-of-freedom Student-t shock to the fitted covariance. Factors share one U within a step; the mean is recalculated from that step's simulated state.",
          },
        },
        {
          expression: "y* = α + βf* + LE zE,  LE LEᵀ = ΣE,  xnext = x + f*",
          reading: {
            ko: "요인 변화에 종목 사이의 상관을 반영한 정규 잔차를 더해 종목의 다음 원화 로그수익률을 만듭니다. 잔차 충격은 요인 충격과 독립입니다. 경제 상태도 변화만큼 누적해 다음 단계의 평균 계산에 사용합니다.",
            en: "Combine factor changes with correlated Gaussian residuals to obtain the next asset KRW log returns. Residual shocks are independent of factor shocks. Accumulate economic changes into the state used for the following step's mean.",
          },
        },
      ],
      symbols: [
        { symbol: "C, ΣF, ΣE", meaning: { ko: "가중 공분산, 축소된 요인 공분산, 축소된 잔차 공분산", en: "Weighted covariance, shrunk factor covariance and shrunk residual covariance" } },
        { symbol: "β, α, ε", meaning: { ko: "요인 민감도, 원화 로그수익률 절편, 설명되지 않은 원화 로그수익률", en: "Factor sensitivities, KRW-log-return intercept and unexplained KRW log return" } },
        { symbol: "I, diag, ᵀ", meaning: { ko: "단위행렬, 대각선만 남긴 행렬, 행과 열을 바꾸는 전치", en: "Identity matrix, diagonal-only matrix, and matrix transpose" } },
        { symbol: "zF, zE, U", meaning: { ko: "서로 독립인 표준 정규 난수 벡터와 자유도 7 카이제곱 난수", en: "Independent standard-normal vectors and a seven-degree-of-freedom chi-square draw" } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "학습 계수는 고정 · 경제 상태와 경로의 무작위 충격은 매 단계 변화", en: "Fitted coefficients stay fixed · state and random shocks evolve each step" },
        nodes: [
          { label: { ko: "상태별 평균", en: "State-dependent mean" }, detail: { ko: "현재 모의 환율·금리에서 계산", en: "Evaluated at simulated FX and rates" } },
          { label: { ko: "공통 요인 충격", en: "Common factor shock" }, detail: { ko: "고정 공분산 · Student-t 7", en: "Fixed covariance · Student-t 7" } },
          { label: { ko: "종목 원화 변화", en: "Asset KRW change" }, detail: { ko: "민감도 적용 + 상관된 잔차", en: "Apply sensitivities + correlated residuals" } },
        ],
      },
      example: {
        ko: "한 종목의 α가 0.0002, 한 요인 β가 0.5, 그 요인 변화가 0.002이고 나머지 요인·잔차 영향이 0인 가상 단계라면 y*=0.0012입니다. 단순수익률은 exp(0.0012)−1 ≈ 0.12007%입니다. 이미 원화 수익률이므로 여기에 달러/원 변화율을 다시 곱하지 않습니다.",
        en: "For an illustrative step with α=0.0002, one factor sensitivity β=0.5, a factor change of 0.002 and zero contribution from other factors and residuals, y*=0.0012. Simple return is exp(0.0012)−1 ≈ 0.12007%. It is already a KRW return, so USD/KRW change is not applied again.",
      },
      caveat: {
        ko: "β는 짧은 관측의 연관성이지 인과 효과가 아닙니다. 상태가 변해도 공분산·β·절편을 다시 추정하지 않습니다. 행렬 분해가 불안정하면 위 식의 행렬 대각선에 작은 수치 보정을 더할 수 있으며 보정량은 진단에 남깁니다. Student-t가 모든 위기나 구조 변화를 담는 것은 아닙니다. 수치가 유효하지 않으면 다른 모형으로 대체하지 않고 계산을 보류합니다.",
        en: "β reflects short-window association, not causation. Covariances, β and intercepts are not refitted as state evolves. Unstable matrix decompositions may add small diagonal jitter to the matrices above, with its magnitude recorded in diagnostics. Student-t shocks do not capture every crisis or structural break. Invalid calculations remain unavailable rather than falling back to another model.",
      },
    },
    {
      id: "paired-weight-objectives",
      title: { ko: "3. 동일한 경로에서 제한된 비중 후보를 비교합니다", en: "3. Compare constrained weights on identical paths" },
      lead: {
        ko: "먼저 종목별 1,000개 경로를 한 번 만듭니다. 현재 비중과 모든 후보가 이 경로를 공유하므로 우연히 유리한 다른 난수를 받은 결과를 비교하지 않습니다. 각 경로에서는 출발 수량을 유지하며 중간 매매나 비중 재조정을 하지 않습니다. 메인 차트는 합산한 포트폴리오 경로를 모두 표시하고, 후보 차트만 표시용 표본 12개를 사용합니다.",
        en: "Generate 1,000 asset-level paths once. Current and candidate weights share them, so comparisons do not reward an allocation merely for receiving a different lucky draw. Each portfolio holds its starting units without intermediate trades or rebalancing. The main chart displays every aggregated portfolio path; only candidate charts use 12 display samples.",
      },
      equations: [
        {
          expression: "Gi,p,h = exp(Σₜ₌₁…h y*i,p,t),  NAVp,h(w) = ΣᵢwᵢGi,p,h",
          reading: {
            ko: "종목별 로그수익률을 더한 뒤 지수함수로 누적 성장 배수를 만듭니다. 시작 비중으로 종목 배수를 합하면 포트폴리오 경로입니다. 매일 비중 가중 수익률을 곱하는 매일 리밸런싱 식과 구분합니다.",
            en: "Exponentiate each asset's cumulative log returns to obtain its growth factor. Weight those factors by initial weights to form a portfolio path. This differs from compounding daily weighted returns, which would imply daily rebalancing.",
          },
        },
        {
          expression: "Rp(w) = NAVp,H(w) − 1,  Smedian = 100 Q0.5(R),  Sdown = 100 Q0.1(R)",
          reading: {
            ko: "경로 마지막의 단순수익률을 정렬해 P50 중간값 또는 P10 하위 경계를 높이는 후보를 찾습니다. 분위수는 정렬된 값 사이를 선형 보간합니다. 표시 점수 단위는 수익률 %입니다.",
            en: "Sort terminal simple returns to seek a higher P50 median or P10 lower boundary. Quantiles linearly interpolate between sorted values. Displayed scores are in return percent.",
          },
        },
        {
          expression: "Sbalance = (Smedian + Sdown) / 2",
          reading: {
            ko: "균형 기준은 중간값과 하위 10% 경계의 단순 평균입니다. 전체 경로의 평균수익률이나 하위 꼬리 평균을 최적화하는 목적식이 아닙니다.",
            en: "The balanced objective is the arithmetic average of the median and lower 10th-percentile scores. It does not optimize the mean return across all paths or a lower-tail average.",
          },
        },
        {
          expression: "R̄sample = (1/1000) Σₚ₌₁…1000 Rₚ",
          reading: {
            ko: "계산된 평균은 1,000개 경로의 표본평균입니다. Student-t 충격은 로그 변화에서 두꺼운 꼬리를 가지므로, 비영 요인 노출을 지수 변환한 가격의 유한한 이론적 평균은 보장되지 않습니다. 이 표본평균을 안정적인 기대수익률로 해석하지 않으며, 비중 탐색의 목적에는 P50·P10 분위수만 사용합니다.",
            en: "A reported average is the sample mean of 1,000 paths. Student-t log shocks have heavy tails; exponentiating nonzero factor exposure does not guarantee a finite theoretical mean price. This sample mean is not a stable expected-return estimate. Weight search instead uses P50 and P10 quantiles.",
          },
        },
        {
          expression: "wᵢ ≥ 0,  Σwᵢ = 1,  wᵢ ≤ max(0.35, maxⱼw0ⱼ)",
          reading: {
            ko: "공매도 없이 비중 합을 100%로 유지합니다. 각 종목의 공통 상한은 35%와 현재 최대 종목 비중 중 큰 값입니다. 기존 집중도가 35%보다 높다고 갑자기 그 아래로 강제 축소하지 않습니다.",
            en: "Keep weights nonnegative and totaling 100%. The shared position cap is the greater of 35% and the largest current position weight. Existing concentration above 35% is not forcibly cut below that level.",
          },
        },
        {
          expression: "Turnover = ½Σᵢ|wᵢ−w0ᵢ| ≤ 0.20,  |ΣnonKRW wᵢ − ΣnonKRW w0ᵢ| ≤ 0.10",
          reading: {
            ko: "사거나 파는 한쪽 기준의 이동량을 20% 이내로 제한합니다. 비원화 표시 종목 비중의 변화는 10%포인트 이내입니다. 이 통화 기준은 ETF 내부 환노출이나 환헤지를 들여다본 전체 경제적 환위험이 아닙니다.",
            en: "Limit one-way turnover to 20%. The change in weight denominated outside KRW is capped at 10 percentage points. This currency constraint does not look through ETFs or hedges to measure total economic FX risk.",
          },
        },
      ],
      symbols: [
        { symbol: "i, p, h, H", meaning: { ko: "종목, 모형 경로, 진행 단계, 마지막 단계의 인덱스", en: "Asset, model path, intermediate step and final horizon indices" } },
        { symbol: "G, NAV, R", meaning: { ko: "종목 성장 배수, 시작 1인 포트폴리오 가치, 마지막 단순수익률", en: "Asset growth factor, portfolio value normalized to 1, and terminal simple return" } },
        { symbol: "w0, w, Qq", meaning: { ko: "현재 비중, 후보 비중, 정렬된 분포의 q 분위수", en: "Current weights, candidate weights and the q quantile of the sorted distribution" } },
        { symbol: "Smedian, Sdown, Sbalance", meaning: { ko: "P50·P10·두 값 평균의 목적 점수, % 단위", en: "Objective scores for P50, P10 and their average, in percent units" } },
      ],
      figure: {
        kind: "bars",
        caption: { ko: "가상 예시 · P50 +5%, P10 −15%인 한 구성의 서로 다른 목적 점수", en: "Illustration · distinct objective scores for one allocation with P50 +5% and P10 −15%" },
        unit: { ko: "%", en: "%" },
        rows: [
          { label: { ko: "중간값 기준", en: "Median objective" }, value: 5 },
          { label: { ko: "하방 기준", en: "Downside objective" }, value: -15 },
          { label: { ko: "균형 기준", en: "Balanced objective" }, value: -5 },
        ],
      },
      example: {
        ko: "현재 A 60%·B 40%에서 A 50%·B 50%로 바꾸면 일방향 이동량은 (10%+10%)/2=10%입니다. A가 원화, B가 비원화라면 비원화 비중 변화는 +10%포인트입니다. 이 예시는 제약식의 검산이며 좋은 후보라는 뜻이 아닙니다.",
        en: "Changing A 60% / B 40% to A 50% / B 50% gives one-way turnover of (10%+10%)/2=10%. If A is KRW-denominated and B is not, non-KRW weight increases by 10 percentage points. This checks the constraints; it does not establish that the allocation is better.",
      },
      caveat: {
        ko: "현재 비중에서 시작해 두 종목 사이를 5%포인트·2.5%포인트·1%포인트 단위로 이동하며 각 크기에서 최대 네 차례 탐색합니다. 모든 가능한 비중을 증명적으로 탐색한 전역 최적해가 아닙니다. 수수료·세금은 0이며 현재 보유종목 안에서만 비교합니다. P10보다 나쁜 경로도 존재합니다.",
        en: "Start from current weights and search pairwise transfers of 5, 2.5 and 1 percentage points, with up to four passes per step size. This is not a proven global optimum over all possible weights. Costs and taxes are zero, and comparisons stay within current holdings. Paths worse than P10 still exist.",
      },
    },
    {
      id: "model-confirmation-and-time-check",
      title: { ko: "4. 모형 안의 확인과 시간순 점검을 구분합니다", en: "4. Separate model confirmation from chronological checks" },
      lead: {
        ko: "현재 후보를 찾는 500개 경로와 확인하는 500개 경로는 같은 모형에서 생성됩니다. 별도의 시간순 점검은 과거 90개 구간만 학습하고 이후 실제 21개 구간을 봅니다. 두 검사를 섞어서 미래 성능이 검증되었다고 표시하지 않습니다.",
        en: "The 500 selection paths and 500 confirmation paths come from the same model. A separate chronological check fits only the preceding 90 intervals and inspects the following 21 actual intervals. These checks do not combine into proof of future performance.",
      },
      equations: [
        {
          expression: "ΔSsearch = Ssearch(w) − Ssearch(w0),  ΔSconfirm = Sconfirm(w) − Sconfirm(w0)",
          reading: {
            ko: "짝수 경로 500개에서 목적 점수를 높이는 후보를 찾고, 홀수 경로 500개에서 같은 후보와 현재 구성을 비교합니다. 두 개선값 모두 10⁻¹²%포인트보다 클 때만 후보를 공개합니다. 조건을 통과하는 후보가 없을 수 있습니다.",
            en: "Search for a better objective on 500 even-indexed paths, then compare that same candidate with current weights on 500 odd-indexed paths. Both improvements must exceed 10⁻¹² percentage points for publication. No candidate may qualify.",
          },
        },
        {
          expression: "Train: [t−89 … t],  Test: [t+1 … t+21]",
          reading: {
            ko: "각 과거 기준점마다 90개 학습 구간으로 모형과 후보를 다시 계산합니다. 뒤의 21개 실제 구간은 후보 선택에 쓰지 않고 보유 후 결과 비교에만 사용합니다. 후속 성과가 현재 비중보다 나빴던 후보도 숨기지 않습니다. 서로 겹치지 않는 후속 구간을 최대 세 개 점검합니다.",
            en: "Refit the model and search candidates from each 90-interval training window. The next 21 actual intervals are unused in selection and only compare subsequent buy-and-hold outcomes. Candidates that later underperform current weights are still reported. Up to three nonoverlapping follow-up windows are checked.",
          },
        },
        {
          expression: "Brier = (ploss − I(Ractual < 0))²",
          reading: {
            ko: "손실 확률과 실제 손실 여부의 차이를 제곱합니다. 확률은 0~1, 실제 손실이면 지시값 I는 1이고 아니면 0입니다. 작을수록 해당 관측의 확률 오차가 작습니다.",
            en: "Square the difference between predicted loss probability and whether a loss occurred. Probability is between 0 and 1; indicator I is 1 for an actual loss and 0 otherwise. A smaller value means a smaller probability error for that observation.",
          },
        },
        {
          expression: "Covered = I(P10 ≤ Ractual ≤ P90),  MedianError = |Ractual − P50|",
          reading: {
            ko: "실제 결과가 모형 P10~P90 안에 들어왔는지와 실제 수익률이 모형 중간값에서 얼마나 떨어졌는지를 따로 봅니다. 경제 상태 조정 모형과 기존 고정 평균 요인 모형을 동일한 현재 비중으로 비교합니다.",
            en: "Separately check whether the actual outcome fell inside P10–P90 and how far its return was from the predicted median. Compare the economic-state model and the existing fixed-mean factor model using identical current weights.",
          },
        },
      ],
      symbols: [
        { symbol: "ΔSsearch, ΔSconfirm", meaning: { ko: "탐색·확인 경로에서 현재 대비 목적 점수 변화, %포인트", en: "Objective improvement over current weights on selection and confirmation paths, in percentage points" } },
        { symbol: "ploss, I", meaning: { ko: "모형 손실 확률과 조건이 참이면 1·거짓이면 0인 지시함수", en: "Model loss probability and an indicator equal to 1 when its condition is true, otherwise 0" } },
        { symbol: "Ractual, P10, P50, P90", meaning: { ko: "후속 실제 수익률과 모형 수익률 분위수. 비교할 때 같은 단위 사용", en: "Subsequent actual return and model return quantiles, compared in matching units" } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "구분해서 읽기 · 모형 경로 확인은 실제 미래 검증과 다릅니다", en: "Keep the distinction · model-path confirmation is not validation on the real future" },
        nodes: [
          { label: { ko: "과거 90개 학습", en: "Fit 90 past intervals" }, detail: { ko: "모형 추정 · 500개로 후보 찾기", en: "Fit model · select using 500 paths" } },
          { label: { ko: "다른 500개 확인", en: "Confirm on another 500" }, detail: { ko: "같은 모형 안의 별도 난수 경로", en: "Separate random paths from the same model" } },
          { label: { ko: "후속 21개 관측", en: "Observe the next 21" }, detail: { ko: "선택에 쓰지 않은 실제 수익률", en: "Actual returns unused in selection" } },
        ],
      },
      example: {
        ko: "손실 확률이 30%였는데 실제로 손실이 났다면 Brier는 (0.3−1)²=0.49입니다. 손실이 없었다면 0.3²=0.09입니다. 단 한 번의 결과로 모형의 정확성을 판정할 수 없고, 최대 세 구간 점검 역시 긴 기간의 검증을 대신하지 않습니다.",
        en: "If predicted loss probability was 30% and a loss occurred, Brier is (0.3−1)²=0.49. With no loss it is 0.3²=0.09. A single outcome cannot establish model accuracy, and checks on at most three windows cannot replace long-horizon validation.",
      },
      caveat: {
        ko: "필요한 공동 자료가 없으면 시간순 점검은 제공하지 않습니다. 당시 공표본과 수정 전 수치가 완전하게 보존되지 않아 엄격한 시점 일치 검증으로 볼 수 없습니다. 현재 종목 집합을 과거에 적용하며 상장 전 자료를 만들지 않습니다. 과거 확인이나 모형 내 개선은 미래 수익·손실 제한을 보장하지 않고 실제 주문이나 목표비중 저장으로 이어지지 않습니다.",
        en: "Chronological checks remain unavailable without the required joint evidence. Incomplete preservation of historical releases and unrevised values prevents a strict point-in-time claim. Today's instrument set is applied to history without inventing pre-listing data. Historical checks and within-model improvements guarantee neither returns nor loss limits and do not place orders or save target weights.",
      },
    },
  ],
} satisfies MethodGuide;
