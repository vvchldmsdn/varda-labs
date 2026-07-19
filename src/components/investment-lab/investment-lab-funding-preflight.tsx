import type { InvestmentLabAccountCompositionScenarioId } from "@/lib/investment-lab-account-composition-contract";
import type {
  InvestmentLabAccountFundingPreflight,
  InvestmentLabFundingResolution,
} from "@/lib/investment-lab-account-funding-preflight";

const SCENARIOS = Object.freeze([
  ["actual", "실제"],
  ["zero_return", "현금"],
  ["kodex200", "KODEX 200"],
  ["voo", "VOO"],
  ["fixed_mix", "고정 혼합"],
  ["anchor_basket", "기준 바스켓"],
] as const satisfies readonly (readonly [
  InvestmentLabAccountCompositionScenarioId,
  string,
])[]);

export function InvestmentLabFundingPreflightView({
  model,
}: {
  model: InvestmentLabAccountFundingPreflight;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]"
      data-cross-account-funding={model.policy.crossAccountFunding}
      data-funding-account-rows={model.coverage.accountCount}
      data-funding-not-requested-cells={model.coverage.notRequestedScenarioCells}
      data-funding-ready-cells={model.coverage.readyScenarioCells}
      data-funding-requested-cells={model.coverage.requestedScenarioCells}
      data-funding-status={model.status}
      data-funding-unavailable-cells={model.coverage.unavailableScenarioCells}
      data-section="investment-lab-funding-preflight"
    >
      <div className="border-b border-[#e1e6dc] px-4 py-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">계정별 자금 경계</h2>
            <p className="mt-1 text-sm leading-6 text-[#687064]">
              각 계정의 시작 평가액과 매수·매도 흐름만 사용한 연구 경로인지
              확인합니다.
            </p>
          </div>
          <p className="text-sm font-semibold text-[#34483f]">
            {statusLabel(model.status)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead className="bg-[#f3f5ee] text-xs font-semibold text-[#5d665b]">
            <tr>
              <th className="px-4 py-3">계정</th>
              {SCENARIOS.map(([, label]) => (
                <th className="px-3 py-3" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.accountRows.map((row) => (
              <tr
                className="border-t border-[#e4e7df]"
                data-funding-account={row.account}
                key={row.account}
              >
                <th className="px-4 py-3 font-semibold uppercase">
                  {row.account}
                </th>
                {SCENARIOS.map(([id]) => (
                  <td className="px-3 py-3" key={id}>
                    <Resolution value={row.scenarios[id]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {model.accountScope === "all" ? (
            <tfoot className="border-t-2 border-[#cfd6ca] bg-[#f7f8f3]">
              <tr>
                <th className="px-4 py-3 font-semibold">전체 합산</th>
                {SCENARIOS.map(([id]) => (
                  <td className="px-3 py-3" key={id}>
                    <Resolution value={model.aggregateScenarios[id]} />
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <p className="border-t border-[#e1e6dc] px-4 py-3 text-xs leading-5 text-[#687064]">
        전체는 통과한 증권·ISA·IRP 결과의 합이며 계정 간 자금을 합쳐 계산하지
        않습니다. 상품 매수 가능 여부, 비용, 세금, 환전 스프레드와 주문 체결은
        아직 검증하지 않은 연구 결과입니다. 따라서 ISA·IRP의 VOO 경로도 실제
        매수 가능성을 뜻하지 않습니다.
      </p>
    </section>
  );
}

function Resolution({ value }: { value: InvestmentLabFundingResolution }) {
  const classes =
    value.status === "ready"
      ? "text-[#1f6a43]"
      : value.status === "unavailable"
        ? "text-[#a5413a]"
        : "text-[#777c72]";
  return (
    <span className={`font-semibold ${classes}`} data-resolution={value.status}>
      {value.status === "ready"
        ? "통과"
        : value.status === "unavailable"
          ? "제외"
          : "미선택"}
    </span>
  );
}

function statusLabel(status: InvestmentLabAccountFundingPreflight["status"]) {
  if (status === "ready") return "전체 통과";
  if (status === "partial") return "일부 경로 제외";
  return "기준 경로 사용 불가";
}
