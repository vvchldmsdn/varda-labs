type SimulationTerminalRiskSummary = Readonly<{
  p50ReturnPct: number;
  p5ReturnPct: number;
  lowerTailMeanReturnPct: number;
  lossProbabilityPct: number;
  maxDrawdownP50Pct: number;
  maxDrawdownP90Pct: number;
}>;

export function SimulationTerminalRiskMetrics({
  terminal,
  compact = false,
}: {
  terminal: SimulationTerminalRiskSummary;
  compact?: boolean;
}) {
  const metrics = [
    ["중앙 경로 수익률", formatSignedPct(terminal.p50ReturnPct)],
    ["P5 종료수익률", formatSignedPct(terminal.p5ReturnPct)],
    [
      "종료수익률 하위 5% 평균",
      formatSignedPct(terminal.lowerTailMeanReturnPct),
    ],
    ["손실 종료 확률", formatPct(terminal.lossProbabilityPct)],
    ["MDD 중앙값", formatPct(terminal.maxDrawdownP50Pct)],
    ["MDD P90 (더 큰 손실)", formatPct(terminal.maxDrawdownP90Pct)],
  ] as const;

  return (
    <dl
      className={
        compact
          ? "grid grid-cols-2 border-b border-[#e1e5da] text-sm"
          : "grid grid-cols-2 border-b border-[#e1e5da] sm:grid-cols-3 xl:grid-cols-6"
      }
      data-simulation-terminal-risk-metrics
    >
      {metrics.map(([label, value]) => (
        <div className="min-w-0 px-3 py-3" key={label}>
          <dt className="text-xs leading-5 text-[#687064]">{label}</dt>
          <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatSignedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
