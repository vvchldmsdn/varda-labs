import type { MethodGuide } from "./method-types";

// Connected authority: app/simulation/page.tsx → db/queries/simulation-owner-research.ts
// → lib/simulation-owner-research-execution.ts. Deferred validation uses
// db/queries/simulation-detail.ts. Optional factor/regime studies are separate models.
export const simulationMethod = {
  title: {
    ko: "수식으로 읽는 시뮬레이션",
    en: "The mathematics of this simulation",
  },
  intro: {
    ko: "현재 보유 구성에 과거 시장의 움직임을 다시 적용하는 연구입니다. 아래 수식은 메인 확률 경로와 과거 검증의 실제 계산을 설명합니다. 모든 그림의 숫자는 이해를 위한 예시이며 내 계좌의 결과가 아닙니다.",
    en: "This research reapplies historical market movements to your current holdings. These formulas describe the main simulated paths and their historical checks. Every diagram uses illustrative numbers, not results from your account.",
  },
  sections: [
    // lib/basis-point-allocation.ts; lib/simulation-return-matrix.ts;
    // lib/simulation-return-matrix-normalization.ts: alignSimulationValue.
    {
      id: "returns",
      title: { ko: "01 · 원화 수익률과 시작 비중", en: "01 · KRW returns and starting weights" },
      lead: {
        ko: "계산에 포함할 수 있는 종목의 현재 원화 평가액으로 시작 비중을 정합니다. 과거 가격에 같은 기준일의 환율을 적용한 뒤, 연속한 관측값 사이의 단순수익률을 만듭니다. 매입원가는 이 계산의 입력이 아닙니다.",
        en: "Starting weights come from the current KRW values of the holdings that can be modeled. Historical prices are converted using FX aligned to each observation date, then consecutive values produce simple returns. Acquisition cost is not an input to this calculation.",
      },
      equations: [
        {
          expression: "wᵢ ≈ Vᵢ / Σⱼ Vⱼ,  Σᵢ wᵢ = 1",
          reading: {
            ko: "포함된 평가액의 합을 100%로 정규화합니다. 비중은 0.01% 단위로 내림한 뒤 소수 잔여가 큰 순서대로 남은 단위를 나눠 합계를 정확히 100%로 맞춥니다.",
            en: "Included values are normalized to 100%. Weights are rounded down to basis points, then remaining basis points go to the largest fractional remainders so that the total is exactly 100%.",
          },
        },
        {
          expression: "Uᵢ,t = Pᵢ,t × Fᵢ,t;  rᵢ,t = Uᵢ,t / Uᵢ,t−1 − 1",
          reading: {
            ko: "현지 통화 가격에 원화 환산율을 곱한 1단위 가치를 비교합니다. 원화 종목의 환산율은 1입니다. t는 달력 날짜 수가 아니라 정렬된 관측 순서입니다.",
            en: "Compare one unit’s value after multiplying its local-currency price by its KRW conversion rate. The conversion rate is 1 for KRW holdings. Here t indexes aligned observations, not elapsed calendar days.",
          },
        },
        {
          expression: "1 + rKRW = (1 + rprice)(1 + rFX)",
          reading: {
            ko: "가격 수익률과 환율 수익률에는 곱의 교차항이 있습니다. 두 퍼센트를 단순히 더하지 않습니다.",
            en: "Price and FX returns interact multiplicatively. Adding their percentages alone omits the cross term.",
          },
        },
      ],
      symbols: [
        { symbol: "Vᵢ, wᵢ", meaning: { ko: "포함 종목 i의 현재 원화 평가액과 최초 비중", en: "Current KRW value and initial weight of included holding i" } },
        { symbol: "Pᵢ,t, Fᵢ,t", meaning: { ko: "관측 t의 현지 통화 종가와 원화 환산율", en: "Local-currency closing price and KRW conversion rate at observation t" } },
        { symbol: "Uᵢ,t, rᵢ,t", meaning: { ko: "원화 환산 1단위 가치와 단순수익률; 0.045는 4.5%", en: "KRW unit value and simple return; 0.045 means 4.5%" } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "예시 · 달러 가격이 올라가도 원화 강세가 수익을 줄일 수 있습니다.", en: "Example · A stronger won can offset part of a USD price gain." },
        nodes: [
          { label: { ko: "기준 가치", en: "Starting value" }, detail: { ko: "$100 × ₩1,400 = ₩140,000", en: "$100 × ₩1,400 = ₩140,000" } },
          { label: { ko: "다음 관측", en: "Next observation" }, detail: { ko: "$110 × ₩1,330 = ₩146,300", en: "$110 × ₩1,330 = ₩146,300" } },
          { label: { ko: "원화 수익률", en: "KRW return" }, detail: { ko: "1.10 × 0.95 − 1 = +4.5%", en: "1.10 × 0.95 − 1 = +4.5%" } },
        ],
      },
      example: {
        ko: "포함 종목의 평가액이 60만 원과 40만 원이면 시작 비중은 60%와 40%입니다. 별도로 제외된 수동 평가 자산이 있다면 이 100%는 전체 자산이 아닌 모형에 포함된 부분의 합계입니다.",
        en: "Included values of ₩600,000 and ₩400,000 give starting weights of 60% and 40%. If manually valued assets are excluded, this 100% describes the modeled subset, not your entire wealth.",
      },
      caveat: {
        ko: "메인 모형은 미조정 종가의 가격 수익률이며 배당·분할을 반영한 총수익률을 주장하지 않습니다. 정렬 시 이전 가격은 최대 7일, 환율은 최대 3일까지만 이어 쓸 수 있습니다. 허용 범위를 넘는 결측값을 0으로 채우지 않으며, 포함 대상 상장 종목의 근거가 부족하면 실행을 막습니다.",
        en: "The main model uses raw closing-price returns; it does not claim dividend- or split-adjusted total returns. Alignment may carry an earlier price for up to 7 days and FX for up to 3 days. Missing values beyond these limits are not filled with zero, and insufficient evidence for an included listed holding blocks execution.",
      },
    },
    // lib/simulation-stationary-bootstrap.ts; lib/simulation-gross-growth.ts;
    // lib/simulation-normalized-nav.ts; lib/simulation-owner-research-execution.ts.
    {
      id: "bootstrap-and-hold",
      title: { ko: "02 · 과거 묶음을 다시 뽑아 보유 경로 만들기", en: "02 · Resample history into buy-and-hold paths" },
      lead: {
        ko: "선택한 기준일까지의 최근 90개 원화 수익률 관측에서 모든 종목의 같은 날 행을 함께 뽑습니다. 평균 길이가 5인 연속 묶음을 이어 500개 경로를 만들며, 기간 선택에 따라 63개 또는 126개 관측 단계를 계산합니다.",
        en: "Each draw takes the entire same-day row of KRW returns across holdings from the latest 90 observations up to the selected cutoff. Consecutive blocks averaging 5 observations form 500 paths, each containing 63 or 126 steps according to the selected horizon.",
      },
      equations: [
        {
          expression: "Pr(restart) = 1/5;  Pr(continue) = 4/5",
          reading: {
            ko: "첫 행은 균등하게 뽑습니다. 이후 단계마다 20% 확률로 새 행을 균등 추출하고, 80% 확률로 이전 행의 다음 행을 씁니다. 마지막 행 다음은 첫 행으로 돌아갑니다. 정확히 5개씩 자르는 방식이 아니라 평균 묶음 길이가 5인 정상 부트스트랩입니다.",
            en: "The first row is drawn uniformly. Each following step has a 20% chance of a new uniform draw and an 80% chance of continuing to the next row, wrapping from the last row to the first. This is a stationary bootstrap with mean block length 5, not fixed five-row chunks.",
          },
        },
        {
          expression: "Gᵢ,m,t = ∏ₛ₌₁ᵗ (1 + rᵢ,Jₘ,ₛ)",
          reading: {
            ko: "선택한 행의 종목별 단순수익률을 복리로 곱합니다. 한 단계에서는 모든 종목에 같은 행 번호 J를 사용하므로 관측 당시의 종목 간 동행을 함께 가져옵니다.",
            en: "Compound each holding’s simple returns from the sampled rows. All holdings use the same row index J at a step, retaining the cross-asset co-movement observed on that row.",
          },
        },
        {
          expression: "Nₘ,t = Σᵢ wᵢ Gᵢ,m,t;  Iₘ,t = 100 Nₘ,t",
          reading: {
            ko: "종목별 누적 성장에 최초 비중을 곱해 합합니다. 내부 시작값은 1, 화면 지수의 시작값은 100입니다. 최초 보유 수량을 유지하는 방식이라 가격이 달라지면 종목 비중도 자연스럽게 달라집니다.",
            en: "Sum each holding’s cumulative growth multiplied by its initial weight. The internal starting value is 1; the displayed index starts at 100. This keeps initial quantities constant, so relative weights drift as prices change.",
          },
        },
      ],
      symbols: [
        { symbol: "m, t, Jₘ,ₛ", meaning: { ko: "경로 번호, 진행 단계, 경로 m의 단계 s에서 뽑힌 과거 행 번호", en: "Path index, step index, and historical row sampled at step s of path m" } },
        { symbol: "Gᵢ,m,t", meaning: { ko: "종목 i의 누적 성장 배수; 시작값 1", en: "Cumulative growth factor of holding i, starting at 1" } },
        { symbol: "Nₘ,t, Iₘ,t", meaning: { ko: "전체 보유의 정규화 가치와 화면의 100 기준 지수", en: "Normalized portfolio value and the displayed index based at 100" } },
      ],
      figure: {
        kind: "lines",
        caption: { ko: "예시 · A와 B를 처음에 절반씩 보유한 2단계 경로", en: "Example · Two steps with equal initial holdings in A and B" },
        xLabel: { ko: "시작 → 1단계 → 2단계", en: "Start → step 1 → step 2" },
        yLabel: { ko: "시작 100의 지수", en: "Index, start = 100" },
        series: [
          { label: { ko: "A", en: "A" }, values: [100, 110, 99] },
          { label: { ko: "B", en: "B" }, values: [100, 100, 100] },
          { label: { ko: "전체 보유", en: "Portfolio" }, values: [100, 105, 99.5] },
        ],
      },
      example: {
        ko: "A가 +10% 후 −10%, B가 계속 0%라면 A의 성장 배수는 1.10 × 0.90 = 0.99입니다. 전체 종료값은 0.5 × 0.99 + 0.5 × 1 = 0.995, 즉 −0.5%입니다. 단계마다 비중을 다시 50:50으로 맞추는 계산과 결과가 다릅니다.",
        en: "If A gains 10% then loses 10% while B stays flat, A’s growth factor is 1.10 × 0.90 = 0.99. The portfolio ends at 0.5 × 0.99 + 0.5 × 1 = 0.995, a −0.5% return. Rebalancing back to 50:50 every step would produce a different result.",
      },
      caveat: {
        ko: "같은 입력과 난수 시드에서는 같은 결과가 나옵니다. 화면의 개별 예시 선은 12개지만 요약은 500개 전체를 사용합니다. 63·126단계는 달력 일수가 아닙니다. 입출금·세금·거래비용·리밸런싱을 반영하지 않으며, 과거에 없던 충격을 새로 만들어 내거나 현재 시장 국면을 조건으로 경로를 고르는 모형도 아닙니다.",
        en: "Identical inputs and the same random seed reproduce the result. Only 12 individual sample paths are drawn, but summaries use all 500. The 63 or 126 steps are not calendar days. Paths omit cash flows, taxes, trading costs and rebalancing; they neither invent shocks absent from the sample nor condition draws on the current market regime.",
      },
    },
    // lib/simulation-normalized-nav-distribution-summary.ts;
    // lib/simulation-terminal-loss-probability.ts.
    {
      id: "quantiles-and-loss",
      title: { ko: "03 · 분위수와 종료 손실의 빈도", en: "03 · Quantiles and terminal-loss frequency" },
      lead: {
        ko: "각 단계에서 500개 경로의 값을 작은 순서로 정렬해 P10·P50·P90을 구합니다. 종료 손실은 마지막 값이 시작값보다 작은 경로만 셉니다. 중간에 잠시 하락한 경로의 비율과는 다른 지표입니다.",
        en: "At each step, sort the 500 path values to calculate P10, P50 and P90. Terminal loss counts only paths that finish below their starting value. It is distinct from the proportion of paths that temporarily fall along the way.",
      },
      equations: [
        {
          expression: "h = (M − 1)q;  k = ⌊h⌋;  λ = h − k",
          reading: {
            ko: "q가 0.1이면 P10, 0.5이면 P50, 0.9이면 P90입니다. 원하는 순위가 두 관측값 사이에 걸리면 그 사이 거리를 λ로 구합니다.",
            en: "Use q = 0.1 for P10, 0.5 for P50, and 0.9 for P90. The fractional part λ measures how far the desired rank lies between two ordered observations.",
          },
        },
        {
          expression: "Qq = (1 − λ)x₍k+1₎ + λx₍k+2₎",
          reading: {
            ko: "정렬한 값의 첫 순위를 1로 두고 이웃 두 값을 선형 보간합니다. 사용하는 방식은 Type 7 분위수입니다. 500개 값의 P50은 250번째와 251번째 값의 평균입니다.",
            en: "With ordered ranks starting at 1, interpolate linearly between neighboring values. This is the Type 7 quantile convention. For 500 values, P50 is the mean of ranks 250 and 251.",
          },
        },
        {
          expression: "Rₘ = Nₘ,H − 1;  p̂loss = (1/M) Σₘ 𝟙{Rₘ < 0}",
          reading: {
            ko: "종료 수익률이 음수인 경로 수를 전체 경로 수로 나눕니다. 정확히 본전인 경로는 손실로 세지 않습니다.",
            en: "Divide the number of paths with a negative terminal return by the total number of paths. A path ending exactly at break-even does not count as a loss.",
          },
        },
      ],
      symbols: [
        { symbol: "M, H", meaning: { ko: "전체 경로 수 500과 선택한 종료 단계 63 또는 126", en: "500 paths and the selected terminal step, 63 or 126" } },
        { symbol: "q, x₍j₎, Qq", meaning: { ko: "분위 수준, 작은 순서로 j번째 값, 보간한 분위수", en: "Quantile level, j-th value in ascending order, and interpolated quantile" } },
        { symbol: "Rₘ, 𝟙{·}", meaning: { ko: "경로 m의 종료 수익률과 조건이 참이면 1, 아니면 0인 지시 함수", en: "Terminal return of path m, and an indicator equal to 1 if the condition is true, otherwise 0" } },
      ],
      figure: {
        kind: "bars",
        caption: { ko: "계산 예시 · 종료 지수가 80, 90, 100, 110, 120인 5개 가상 경로", en: "Calculation example · Five illustrative terminal indices: 80, 90, 100, 110, 120" },
        unit: { ko: "지수 · 시작 100", en: "Index · start 100" },
        rows: [
          { label: { ko: "P10", en: "P10" }, value: 84 },
          { label: { ko: "P50", en: "P50" }, value: 100 },
          { label: { ko: "P90", en: "P90" }, value: 116 },
        ],
      },
      example: {
        ko: "위 5개 값의 P10은 80과 90 사이의 40% 지점인 84입니다. 실제 모형에서 500개 중 175개가 손실로 끝나면 표시 빈도는 35%입니다. 경로 하나가 더 손실로 바뀌면 0.2%p 변합니다.",
        en: "For the five values above, P10 is 40% of the way from 80 to 90, or 84. In the actual 500-path model, 175 loss-ending paths give a frequency of 35%. One additional loss-ending path changes it by 0.2 percentage points.",
      },
      caveat: {
        ko: "이 빈도는 과거 표본을 재추출한 모형 안의 비율이며 실제 미래 손실 확률을 보증하지 않습니다. P10–P90은 각 시점의 가운데 80% 구간입니다. 경로 전체가 그 안에 머물 확률이 80%라는 뜻이 아니며, P50 선도 보통 하나의 실제 추출 경로와 일치하지 않습니다.",
        en: "This frequency belongs to a model that resamples historical observations; it is not a guaranteed probability of future loss. P10–P90 is the central 80% interval at each step, not an 80% probability of remaining inside it for the entire path. The P50 line generally does not correspond to one sampled path.",
      },
    },
    // lib/simulation-terminal-downside-tail.ts and its policy;
    // lib/simulation-path-max-drawdown.ts and distribution-summary.
    {
      id: "tail-and-drawdown",
      title: { ko: "04 · 나쁜 종료 결과와 도중의 최대 낙폭", en: "04 · Bad endings and the deepest interim fall" },
      lead: {
        ko: "하위 5% 평균은 종료 시점의 나쁜 결과를, 최대 낙폭은 경로 도중 고점에서 얼마나 내려갔는지를 봅니다. 수익으로 끝난 경로도 중간에는 큰 낙폭을 겪을 수 있습니다.",
        en: "The lower-tail mean measures bad terminal outcomes, while maximum drawdown measures the deepest fall from a running peak along a path. A path can finish with a gain after experiencing a large interim drawdown.",
      },
      equations: [
        {
          expression: "P5 = Q₀.₀₅(R);  T₅ = (1/25) Σⱼ₌₁²⁵ R₍j₎",
          reading: {
            ko: "종료 수익률 500개를 정렬합니다. P5는 앞서 설명한 보간 분위수이고, T₅는 가장 작은 25개를 정확히 골라 평균한 하위 5% 수익률입니다. 경계에서 동률이 나와도 25개보다 더 많이 포함하지 않습니다.",
            en: "Sort all 500 terminal returns. P5 uses the interpolated quantile above; T₅ averages exactly the lowest 25 returns. Ties at the cutoff do not expand the tail beyond 25 observations.",
          },
        },
        {
          expression: "CVaRloss,5% = −T₅",
          reading: {
            ko: "손실을 양수로 적는 CVaR·Expected Shortfall 관례로 읽으려면 부호를 뒤집습니다. 화면의 하위 5% 평균은 수익률 부호를 유지하므로 −14%가 손실을 뜻합니다.",
            en: "To express this empirical tail mean using the loss-positive CVaR / Expected Shortfall convention, reverse its sign. The displayed lower-tail mean keeps the return sign, so −14% represents a loss.",
          },
        },
        {
          expression: "Peakₘ,t = max₀≤s≤t Nₘ,s",
          reading: {
            ko: "시작값 1을 포함해 해당 단계까지의 최고 가치를 기억합니다.",
            en: "Keep the highest value reached through this step, including the starting value of 1.",
          },
        },
        {
          expression: "MDDₘ = maxₜ (1 − Nₘ,t / Peakₘ,t)",
          reading: {
            ko: "각 단계의 고점 대비 하락 비율 중 가장 큰 값을 선택합니다. 낙폭은 양수 크기입니다. MDD P50·P90은 경로 500개에서 각각 구한 MDD의 분위수입니다.",
            en: "Take the largest proportional decline from the running peak. Drawdown is a nonnegative magnitude. MDD P50 and P90 are quantiles of the 500 individually calculated path drawdowns.",
          },
        },
      ],
      symbols: [
        { symbol: "R₍j₎, T₅", meaning: { ko: "종료 수익률의 오름차순 j번째 값과 하위 25개 평균", en: "j-th smallest terminal return and the mean of the lowest 25" } },
        { symbol: "Peakₘ,t, MDDₘ", meaning: { ko: "경로 m의 단계 t까지 최고값과 경로 전체 최대 낙폭", en: "Running peak through step t and maximum drawdown for path m" } },
      ],
      figure: {
        kind: "lines",
        caption: { ko: "예시 · 최종 수익 +10%여도 최대 낙폭은 25%", en: "Example · A +10% final return can coexist with a 25% drawdown" },
        xLabel: { ko: "경로의 관측 순서", en: "Observation order along the path" },
        yLabel: { ko: "시작 100의 지수", en: "Index, start = 100" },
        series: [
          { label: { ko: "경로 가치", en: "Path value" }, values: [100, 120, 90, 110] },
          { label: { ko: "누적 최고값", en: "Running peak" }, values: [100, 120, 120, 120] },
        ],
      },
      example: {
        ko: "그림의 낙폭은 1 − 90/120 = 25%입니다. 별도의 하위 꼬리 계산 예로, 최악의 25개 중 5개가 −30%, 나머지 20개가 −10%이면 하위 5% 평균은 (5 × −30 + 20 × −10)/25 = −14%입니다.",
        en: "The diagram’s drawdown is 1 − 90/120 = 25%. As a separate tail example, if the worst 25 returns comprise five at −30% and twenty at −10%, their mean is (5 × −30 + 20 × −10)/25 = −14%.",
      },
      caveat: {
        ko: "MDD는 P50 가격 선 하나에서 계산한 낙폭이 아닙니다. 하위 5%는 25개 경로의 결과이므로 표본에 민감하며 최악의 가능한 손실 한도를 뜻하지 않습니다. 관측 단계 사이에 발생한 장중 낙폭은 포착하지 못합니다.",
        en: "MDD is not computed from the P50 value line alone. The lower 5% contains just 25 paths, making it sample-sensitive; it is not a bound on the worst possible loss. Intraday falls between observation steps are not captured.",
      },
    },
    // lib/simulation-owner-walk-forward-validation.ts;
    // lib/simulation-owner-constrained-min-volatility.ts;
    // lib/investment-lab-preperiod-optimizer-math.ts;
    // lib/simulation-owner-historical-outcome-validation.ts;
    // lib/simulation-historical-outcome-comparison.ts.
    {
      id: "historical-validation",
      title: { ko: "05 · 과거 검증: 비중 후보와 분포를 따로 검사", en: "05 · Historical checks for weights and distributions" },
      lead: {
        ko: "두 검증은 질문이 다릅니다. 워크포워드는 앞선 60개 관측으로 만든 비중 후보를 다음 10개에서 현재 비중과 비교합니다. 분포 검증은 앞선 90개로 21단계 분포를 만든 뒤 실제 다음 21개 관측 결과가 어디에 놓였는지 확인합니다.",
        en: "These checks answer different questions. Walk-forward validation fits a weight candidate on 60 observations and compares it with current weights over the next 10. Distribution validation uses 90 observations to simulate 21 steps, then checks the actual next 21 observations against that distribution.",
      },
      equations: [
        {
          expression: "w* ≈ arg min wᵀΣ̃w;  Σᵢwᵢ = 1,  0 ≤ wᵢ ≤ c",
          reading: {
            ko: "각 학습 구간에서 공분산의 비대각 성분을 10% 줄인 추정치로 최소 분산 후보를 수치적으로 찾습니다. 종목 상한 c는 35%와 현재 최대 종목 비중 중 큰 값입니다. 이후 현재 비중과 섞어 편도 교체 비율 20%, 비원화 노출 변화 10%p 이내로 제한하고, 반올림한 후보의 학습 변동성이 더 높으면 채택하지 않습니다.",
            en: "Within each training window, numerically seek a minimum-variance candidate using a covariance estimate with off-diagonal terms reduced by 10%. The holding cap c is the greater of 35% and the largest current weight. Blend toward current weights to limit one-way turnover to 20% and non-KRW exposure change to 10 percentage points; reject a rounded candidate whose training volatility is higher.",
          },
        },
        {
          expression: "σann = √252 × s(rportfolio)",
          reading: {
            ko: "테스트 구간의 실제 관측을 보유 방식으로 적용한 경로에서 단계별 수익률의 표본 표준편차 s를 구해 연율화합니다. 연율화는 비교용 환산이며 10개 관측이 1년의 증거가 된다는 뜻은 아닙니다.",
            en: "Calculate the sample standard deviation s of step returns along the buy-and-hold path over the observed test window, then annualize it. This is a comparison convention; 10 observations do not become a year of evidence.",
          },
        },
        {
          expression: "Rchain = ∏f (1 + Rf) − 1",
          reading: {
            ko: "워크포워드의 겹치지 않는 테스트 구간 중 계산 가능한 구간의 수익률을 최대 3개까지 복리로 연결합니다. 각 구간 안에서는 보유 수량을 유지하지만 구간 경계에서는 비용 없이 해당 비중으로 다시 맞춘 가정입니다.",
            en: "Compound returns from the available non-overlapping walk-forward test windows, up to three. Quantities stay fixed within a window, but weights reset without costs at each window boundary.",
          },
        },
        {
          expression: "Coverage = (1/K) Σₖ 𝟙{Q₀.₁,k ≤ Ractual,k ≤ Q₀.₉,k}",
          reading: {
            ko: "별도의 90→21 분포 검증에서 실제 종료 수익률이 P10–P90 안에 들어온 유효 구간의 비율입니다. 경계값도 포함합니다. 21개 관측 간격으로 최대 7구간을 검사하며 근거가 없는 구간은 꾸며 넣지 않습니다.",
            en: "For the separate 90→21 distribution check, measure the fraction of valid windows whose actual terminal return lies within P10–P90, including the boundaries. Up to seven endpoints are spaced 21 observations apart; unavailable windows are not fabricated.",
          },
        },
        {
          expression: "MAE(pp) = (100/K) Σₖ |Ractual,k − Q₀.₅,k|",
          reading: {
            ko: "실제 종료 수익률과 사전에 만든 P50의 절대 차이를 유효 구간에서 평균해 %p로 표시합니다. 오차의 크기이며 상승·하락 방향을 맞힌 비율이 아닙니다.",
            en: "Average the absolute difference between the actual terminal return and the previously simulated P50 across valid windows, expressed in percentage points. This measures error magnitude, not directional accuracy.",
          },
        },
      ],
      symbols: [
        { symbol: "Σ̃, c, w*", meaning: { ko: "학습 자료의 축소 공분산 추정치, 종목 비중 상한, 제한을 적용하기 전 최소 분산 후보", en: "Shrunk training covariance, holding-weight cap, and minimum-variance candidate before blending constraints" } },
        { symbol: "Rf, s, σann", meaning: { ko: "테스트 구간 f의 수익률, 표본 표준편차, 연율화 변동성", en: "Return in test window f, sample standard deviation, and annualized volatility" } },
        { symbol: "K, Ractual,k, Qq,k", meaning: { ko: "분포 검증의 유효 구간 수, 구간 k의 관측 종료 수익률, 그 구간 전에 추정한 분위수", en: "Number of valid distribution-check windows, observed terminal return in window k, and its previously estimated quantile" } },
      ],
      figure: {
        kind: "flow",
        caption: { ko: "워크포워드의 실제 구간 구성 · 번호는 90개 관측의 순서", en: "Actual walk-forward window structure · Numbers index the 90 observations" },
        nodes: [
          { label: { ko: "검증 1", en: "Fold 1" }, detail: { ko: "학습 1–60 → 테스트 61–70", en: "Train 1–60 → test 61–70" } },
          { label: { ko: "검증 2", en: "Fold 2" }, detail: { ko: "학습 11–70 → 테스트 71–80", en: "Train 11–70 → test 71–80" } },
          { label: { ko: "검증 3", en: "Fold 3" }, detail: { ko: "학습 21–80 → 테스트 81–90", en: "Train 21–80 → test 81–90" } },
        ],
      },
      example: {
        ko: "워크포워드 수익률이 +2%, −1%, +3%라면 연결 수익률은 1.02 × 0.99 × 1.03 − 1 ≈ +4.01%입니다. 별도의 분포 검증에서 유효 3구간 중 2개가 밴드에 들고 P50 절대 오차가 2·4·3%p라면 커버리지는 66.7%, 평균 절대 오차는 3%p입니다.",
        en: "Walk-forward returns of +2%, −1% and +3% compound to 1.02 × 0.99 × 1.03 − 1 ≈ +4.01%. Separately, if two of three valid distribution-check windows land inside the band and their absolute P50 errors are 2, 4 and 3 percentage points, coverage is 66.7% and mean absolute error is 3 percentage points.",
      },
      caveat: {
        ko: "검증은 현재 종목 구성을 과거에 적용한 반사실 비교입니다. 과거에 실제로 그 종목·수량을 보유했다는 기록이나 투자 추천이 아닙니다. 비중 후보 계산은 테스트 이후 자료를 쓰지 않지만 현재 구성 자체에는 사후 선택의 한계가 남습니다. 90→21 검증은 최소 111개 수익률 관측이 필요하고 메인 화면의 63·126단계 선택과 독립적입니다. 적은 구간의 높은 커버리지만으로 모형의 신뢰성을 확정할 수 없습니다.",
        en: "These are counterfactual checks that apply today’s holdings to history, not records of your actual past positions or investment recommendations. Candidate fitting avoids later test data, but selecting today’s composition retrospectively still introduces hindsight limitations. The 90→21 check requires at least 111 return observations and is independent of the main 63/126-step selector. High coverage across a small number of windows cannot establish model reliability.",
      },
    },
  ],
} satisfies MethodGuide;
