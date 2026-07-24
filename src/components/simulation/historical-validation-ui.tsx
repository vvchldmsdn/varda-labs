export function HistoricalValidationSummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-3">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#687064]">{detail}</p>
    </div>
  );
}

export function formatHistoricalValidationDate(value: string) {
  return value.replaceAll("-", ".");
}

export function formatHistoricalValidationPct(value: number) {
  return `${value.toFixed(2)}%`;
}

export function formatHistoricalValidationSignedPct(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatHistoricalValidationPctPoint(value: number) {
  return `${value.toFixed(2)}%p`;
}

export function formatNullableHistoricalValidationPct(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

export function formatNullableHistoricalValidationPctPoint(
  value: number | null,
) {
  return value === null ? "-" : formatHistoricalValidationPctPoint(value);
}

export function historicalValidationReasonLabel(reason: string) {
  if (reason === "input_matrix_unavailable") return "필요한 관측값 부족";
  if (reason === "input_matrix_shape_mismatch") return "관측 구간 불일치";
  if (reason === "simulation_unavailable") return "경로 계산 불가";
  if (reason === "observed_path_unavailable") return "실제 경로 계산 불가";
  return "입력 확인 필요";
}
