/** Presentation only. Monetary/return calculations belong to the domain layer. */
export function formatNumber(
  value: number | null | undefined,
  options: Pick<Intl.NumberFormatOptions, "maximumFractionDigits" | "minimumFractionDigits" | "signDisplay"> = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const maximumFractionDigits = options.maximumFractionDigits ?? 2;
  const normalized = Math.abs(value) < .5 * 10 ** -maximumFractionDigits ? 0 : value;
  return normalized.toLocaleString("ko-KR", {
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits,
    signDisplay: options.signDisplay ?? "auto",
  });
}

export function formatPercent(value: number | null | undefined, digits = 2, signed = false): string {
  const text = formatNumber(value, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  });
  return text === "—" ? text : text + "%";
}
