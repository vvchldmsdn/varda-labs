export function normalizeTicker(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export function convertToKrw(value: number, currency: string, usdKrwRate: number) {
  return currency === "USD" ? value * usdKrwRate : value;
}

export function percentOrNull(
  numerator: number | null,
  denominator: number | null,
) {
  return numerator !== null && denominator !== null && denominator > 0
    ? (numerator / denominator) * 100
    : null;
}

export function diffDays(laterDate: string, earlierDate: string) {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return 0;
  return Math.round((later - earlier) / 86_400_000);
}

export function sumBy<T>(
  rows: T[],
  selector: (row: T) => number | null | undefined,
) {
  return rows.reduce((sum, row) => sum + (selector(row) ?? 0), 0);
}

export function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
