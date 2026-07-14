import type {
  InvestmentLabSmallAdjustmentCalculation,
  InvestmentLabSmallAdjustmentCalculationBlocker,
} from "@/lib/investment-lab-small-adjustment";

export function InvestmentLabSmallAdjustmentResult({
  result,
}: {
  result: InvestmentLabSmallAdjustmentCalculation;
}) {
  if (result.status === "blocked") {
    return (
      <div className="rounded-lg border border-[#d8c7a1] bg-[#fff8e6] p-4 text-sm text-[#725f2d]">
        {result.blockers.map((blocker) => (
          <p key={blocker}>{calculationBlockerLabel(blocker)}</p>
        ))}
      </div>
    );
  }

  const largestDelta =
    result.afterConcentration.largestHoldingWeightPct -
    result.beforeConcentration.largestHoldingWeightPct;
  const hhiDelta =
    result.afterConcentration.hhiPoints -
    result.beforeConcentration.hhiPoints;

  return (
    <div
      className="space-y-4 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-adjustment-result="ready"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">조정 전후 비교</h3>
          <p className="mt-1 text-sm text-[#687064]">
            {accountLabel(result.account)} · {formatKrw(result.transferAmountKrw)}
          </p>
        </div>
        <p className="text-xs text-[#777e73]">
          현재 평가액 고정 · 거래비용 0원 · 저장 안 함
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ResultCell
          detail={`${formatPercent(result.source.beforeWeightPct)} → ${formatPercent(result.source.afterWeightPct)}`}
          label={`감소 · ${holdingLabel(result.source)}`}
          value={`${formatKrw(result.source.beforeValueKrw)} → ${formatKrw(result.source.afterValueKrw)}`}
        />
        <ResultCell
          detail={`${formatPercent(result.destination.beforeWeightPct)} → ${formatPercent(result.destination.afterWeightPct)}`}
          label={`증가 · ${holdingLabel(result.destination)}`}
          value={`${formatKrw(result.destination.beforeValueKrw)} → ${formatKrw(result.destination.afterValueKrw)}`}
        />
        <ResultCell
          detail={formatSignedPercentagePoints(largestDelta)}
          label="최대 종목 비중"
          value={`${formatPercent(result.beforeConcentration.largestHoldingWeightPct)} → ${formatPercent(result.afterConcentration.largestHoldingWeightPct)}`}
        />
        <ResultCell
          detail={formatSignedNumber(hhiDelta)}
          label="보유 집중도 HHI"
          value={`${formatNumber(result.beforeConcentration.hhiPoints)} → ${formatNumber(result.afterConcentration.hhiPoints)}`}
        />
      </div>

      <section className="overflow-hidden rounded-md border border-[#e1e6dc]">
        <div className="border-b border-[#e1e6dc] bg-white px-4 py-3">
          <h4 className="font-semibold">통화 노출 변화</h4>
          <p className="mt-1 text-xs text-[#687064]">
            직접 보유 평가액 기준이며 ETF 구성종목 통화는 펼치지 않습니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
                <th className="px-4 py-3">통화</th>
                <th className="px-3 py-3 text-right">조정 전</th>
                <th className="px-3 py-3 text-right">조정 후</th>
                <th className="px-4 py-3 text-right">비중 변화</th>
              </tr>
            </thead>
            <tbody>
              {result.currencyExposures.map((row) => (
                <tr className="border-t border-[#e1e6dc]" key={row.currency}>
                  <td className="px-4 py-3 font-semibold">{row.currency}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatKrw(row.beforeValueKrw)} · {formatPercent(row.beforeWeightPct)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatKrw(row.afterValueKrw)} · {formatPercent(row.afterWeightPct)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatSignedPercentagePoints(row.changePercentagePoints)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ResultCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[#e1e6dc] bg-white p-3">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-2 break-words text-base font-semibold tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs tabular-nums text-[#687064]">{detail}</p>
    </div>
  );
}

function calculationBlockerLabel(
  blocker: InvestmentLabSmallAdjustmentCalculationBlocker,
) {
  switch (blocker) {
    case "account_unavailable":
      return "선택 계정의 평가 근거가 완전하지 않아 계산하지 않았습니다.";
    case "source_holding_unavailable":
      return "줄일 보유자산을 다시 선택해 주세요.";
    case "destination_holding_unavailable":
      return "늘릴 보유자산을 다시 선택해 주세요.";
    case "same_holding":
      return "서로 다른 두 보유자산을 선택해야 합니다.";
    case "invalid_transfer_amount":
      return "이동 금액은 1원 이상의 정수여야 합니다.";
    case "insufficient_source_value":
      return "이동 금액이 줄일 보유자산의 현재 평가액보다 큽니다.";
    case "invalid_calculation_result":
      return "총 평가액 보존을 검증하지 못해 결과를 표시하지 않습니다.";
  }
}

function accountLabel(account: string) {
  if (account === "brokerage") return "증권";
  return account.toUpperCase();
}

function holdingLabel(holding: { name: string; ticker: string | null }) {
  return holding.ticker ? `${holding.ticker} · ${holding.name}` : holding.name;
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatSignedPercentagePoints(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%p`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function formatSignedNumber(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}
