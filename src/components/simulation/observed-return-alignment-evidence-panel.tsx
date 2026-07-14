import type { SimulationInputReadinessPageModel } from "@/lib/simulation-input-readiness";

type AlignmentEvidence =
  SimulationInputReadinessPageModel["observedReturnAlignmentEvidence"];

export function ObservedReturnAlignmentEvidencePanel({
  evidence,
}: {
  evidence: AlignmentEvidence;
}) {
  return (
    <section
      data-cross-market-alignment={evidence.status}
      data-alignment-service-date-count={evidence.serviceDateCount}
      aria-labelledby="cross-market-alignment-title"
      className="mt-5 border-y border-[#d7ddcf] py-4"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2
            id="cross-market-alignment-title"
            className="text-lg font-semibold tracking-normal"
          >
            교차시장 정렬 근거
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[#596158]">
            공통 서비스 날짜에 정확한 관측값이 없으면 가격은 최대 7일, USD/KRW는
            최대 3일 범위에서 직전 저장값을 사용합니다. 휴장일을 실제 거래일로
            간주하거나 미래 값을 당겨 쓰지 않습니다.
          </p>
        </div>
        <p className="text-xs leading-5 text-[#687064]">
          원본 가격·환율·관측 날짜는 표시하지 않음
        </p>
      </div>

      {evidence.status === "unavailable" ? (
        <p className="mt-3 text-sm text-[#6b5227]">
          비교 입력이 완전히 준비되지 않아 정렬 집계를 표시하지 않습니다.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-2 font-semibold">종목</th>
                <th className="px-3 py-2 text-right font-semibold">
                  가격 정확 관측
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  가격 직전값 적용
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  가격 최대 적용
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  환율 정확 관측
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  환율 직전값 적용
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  환율 최대 적용
                </th>
              </tr>
            </thead>
            <tbody>
              {evidence.instruments.map((instrument) => (
                <tr
                  key={instrument.id}
                  data-alignment-instrument={instrument.id}
                  data-price-carry-count={
                    instrument.price.carriedObservationCount
                  }
                  data-fx-carry-count={
                    instrument.fx.status === "required"
                      ? instrument.fx.carriedObservationCount
                      : 0
                  }
                  className="border-b border-[#e1e5da]"
                >
                  <th className="px-3 py-3 font-semibold">
                    {instrument.ticker}
                    <span className="ml-2 font-normal text-[#687064]">
                      {instrument.name}
                    </span>
                  </th>
                  <MetricCell
                    value={`${instrument.price.exactObservationCount}/${evidence.serviceDateCount}`}
                  />
                  <MetricCell
                    value={`${instrument.price.carriedObservationCount}회`}
                  />
                  <MetricCell
                    value={`${instrument.price.maxCarryDaysUsed}일`}
                    detail={`정책 ${instrument.price.policyMaxCarryDays}일`}
                  />
                  {instrument.fx.status === "required" ? (
                    <>
                      <MetricCell
                        value={`${instrument.fx.exactObservationCount}/${evidence.serviceDateCount}`}
                      />
                      <MetricCell
                        value={`${instrument.fx.carriedObservationCount}회`}
                      />
                      <MetricCell
                        value={`${instrument.fx.maxCarryDaysUsed}일`}
                        detail={`정책 ${instrument.fx.policyMaxCarryDays}일`}
                      />
                    </>
                  ) : (
                    <td
                      colSpan={3}
                      className="px-3 py-3 text-right text-[#687064]"
                    >
                      KRW 종목 · 환율 불필요
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-[#687064]">
        정확 관측은 해당 서비스 날짜에 대응하는 저장 근거를 뜻합니다. 직전값
        적용은 휴장일 등으로 정책 범위 안의 가장 최근 저장 근거를 사용한
        횟수입니다.
      </p>
    </section>
  );
}

function MetricCell({ value, detail }: { value: string; detail?: string }) {
  return (
    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
      <span className="font-semibold">{value}</span>
      {detail ? (
        <span className="ml-1 text-xs text-[#687064]">({detail})</span>
      ) : null}
    </td>
  );
}
