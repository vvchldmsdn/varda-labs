import { T } from "@/components/i18n/localized-text";
import type { InvestmentLabScenarioMatrixId } from "@/lib/investment-lab-scenario-matrix";
import { InvestmentLabEvidenceGroup } from "./investment-lab-evidence-group";
import { LabText } from "./lab-text";
import { labScenarioLabel } from "./investment-lab-chart-presentation";
import styles from "./investment-lab-explanation.module.css";

type Copy = Readonly<{ ko: string; en: string }>;
const scenarioMethods: Record<InvestmentLabScenarioMatrixId, Copy> = {
  actual: { ko: "선택한 기간에 저장된 실제 보유자산 평가액입니다. 다른 시나리오가 얼마나 달랐는지 확인하는 기준선입니다.", en: "These are your recorded invested-asset values for the selected period. They are the baseline for comparing every hypothetical path." },
  kodex200: { ko: "시작 금액을 국내 지수 ETF인 KODEX 200에 모두 투자했다고 가정합니다. 이후 실제 매수·매도 금액도 이 ETF에 동일하게 반영합니다.", en: "Assume the starting amount was invested entirely in KODEX 200, a Korean index ETF. Subsequent actual purchase and sale amounts are replayed in that ETF." },
  voo: { ko: "시작 금액을 미국 S&P 500 ETF인 VOO에 모두 투자했다고 가정합니다. 실제 매수·매도 금액을 재현하고, 달러 가격과 당시 환율을 함께 반영합니다.", en: "Assume the starting amount was invested entirely in VOO, a US S&P 500 ETF. Replay actual purchase and sale amounts, using dollar prices and date-specific exchange rates." },
  fixed_mix: { ko: "시작 금액과 이후 매수·매도 금액을 정해 둔 비율로 KODEX 200과 VOO에 나눕니다. 가격이 달라져 두 자산의 비중이 바뀌어도 자동으로 원래 비중에 맞추지는 않습니다.", en: "Split the starting amount and each later purchase or sale between KODEX 200 and VOO at the selected ratio. The holdings are not automatically rebalanced when prices cause their weights to drift." },
  preperiod_min_volatility: { ko: "비교 시작일보다 앞선 두 ETF의 움직임만 보고, 과거 흔들림이 가장 작았던 혼합 비율을 구합니다. 그 비율로 비교 기간을 재현하며, 비교 기간의 결과를 미리 보고 비율을 고르지 않습니다.", en: "Use only the two ETFs' movements before the comparison starts to find the mix with the lowest historical volatility. Replay the comparison period with that mix, without using its later outcome to choose the weights." },
  zero_return: { ko: "시작 금액에 실제 매수 금액을 더하고 매도 금액을 뺍니다. 가격 변화나 이자는 없는 것으로 가정해, 돈을 넣고 뺀 효과만 남긴 기준선입니다.", en: "Add actual purchase amounts to the starting value and subtract sale amounts. Assume no price changes or interest, leaving a baseline that shows investment flows alone." },
  anchor_basket: { ko: "기준일에 보유한 종목마다 시작 금액을 똑같이 나눕니다. 이후 투자금도 같은 비율로 배분하지만, 가격 때문에 달라진 비중을 다시 맞추지는 않습니다.", en: "Divide the starting amount equally among the holdings recorded on the anchor date. Later flows use those equal allocations, but price-driven weight changes are not rebalanced." },
  anchor_value_weight: { ko: "기준일에 저장된 종목별 비중으로 시작하고, 이후 투자금도 그 비율로 배분합니다. '처음 비중'은 배분 기준이며, 가격이 움직일 때마다 비중을 고정한다는 뜻은 아닙니다.", en: "Start with the holdings' recorded anchor-date weights and use those ratios for later flows. The initial weights are an allocation rule, not a promise to keep market weights constant as prices change." },
  anchor_current_weight_monthly: { ko: "기준일의 비중으로 시작한 뒤, 새 달의 첫 비교일에 상장 종목의 비중을 다시 맞춥니다. 처리 중인 매매가 있으면 완료될 때까지 조정을 미룹니다.", en: "Start with the anchor-date weights, then restore listed holdings to those weights on the first comparison date of each new month. Pending trades defer the rebalance until they are complete." },
  approved_target_weight_monthly: { ko: "관리에서 승인한 목표비중을 사용해 상장 종목의 비중을 매월 다시 맞춥니다. 목표가 적용되기 전 날짜까지 거꾸로 적용하지 않으며, 현재 종목 구성과 목표의 근거가 맞아야 합니다.", en: "Use the approved target allocation to rebalance listed holdings monthly. Targets are not backdated before their effective date, and the policy must match the current holding universe." },
  anchor_equal_weight_monthly: { ko: "상장 종목에 같은 몫을 주고, 새 달의 첫 비교일마다 다시 같은 비중으로 맞춥니다. 수동 평가 자산은 이 조정과 투자금 재배분에서 따로 유지합니다.", en: "Give listed holdings equal shares and restore equal weights on the first comparison date of each new month. Manually valued assets remain separate from this rebalance and its flow allocations." },
};

export function InvestmentLabScenarioMethod({ scenarioId }: { scenarioId: InvestmentLabScenarioMatrixId }) {
  return <div className={styles.method}>
    <div className={styles.methodLead}>
      <h3><LabText value={labScenarioLabel(scenarioId)} /></h3>
      <p><T {...scenarioMethods[scenarioId]} /></p>
    </div>
    <dl className={styles.methodFacts}>
      <div><dt><T ko="같게 두는 것" en="What stays the same" /></dt><dd><T ko="비교 기간 · 시작 평가액 · 실제 매수와 매도로 투자한 금액" en="Comparison period, starting value, and actual investment flows from purchases and sales" /></dd></div>
      <div><dt><T ko="이렇게 읽어요" en="How to read it" /></dt><dd><T ko="주황 선이 검은 선보다 높으면, 그날 가상 평가액이 실제보다 큰 것입니다." en="When the orange line is above the black line, the hypothetical assets are worth more on that date." /></dd></div>
    </dl>
    <InvestmentLabEvidenceGroup title={{ ko: "비교할 때 기억할 점", en: "Keep these limits in mind" }} description={{ ko: "현금 · 수익률 · 비용 · 계산이 비는 이유", en: "Cash, returns, costs, and unavailable results" }}>
      <div className="space-y-4">
        <p className={styles.methodNote}><T ko="평가액은 현금 잔액을 제외한 보유자산의 가치입니다. 입금·출금 자체를 매수·매도로 세지 않습니다. 계좌별 흐름을 확인한 뒤 전체 범위의 결과를 합칩니다." en="Values cover invested assets, excluding cash balances. Deposits and withdrawals alone are not purchases and sales. The all-account view combines paths only after validating each account's flows." /></p>
        <p className={styles.methodNote}><T ko="평가액 차이에는 투자한 금액의 영향도 포함됩니다. 추정수익률과 최대낙폭은 투자금 흐름을 조정한 별도 결과이며, 필요한 근거가 없으면 표시하지 않습니다." en="Value differences also reflect invested amounts. Estimated returns and maximum drawdowns use separate flow-adjusted calculations and remain unavailable without sufficient evidence." /></p>
        <p className={styles.methodNote}><T ko="원종가 경로에는 배당·기업행사 조정이 없고, 가상 계산은 거래비용·세금·환전 비용을 따로 차감하지 않습니다. 과거 차이는 미래 수익을 예측하거나 투자할 자산을 추천하는 결과가 아닙니다." en="Raw-close paths exclude dividend and corporate-action adjustments. Hypothetical calculations do not separately deduct trading costs, taxes, or FX spreads. Historical differences neither predict future returns nor recommend investments." /></p>
      </div>
    </InvestmentLabEvidenceGroup>
  </div>;
}
