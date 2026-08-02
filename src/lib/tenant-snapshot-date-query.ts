export function parseTenantSnapshotDateQuery(
  value: string | readonly string[] | null | undefined,
): string | undefined | null {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    return value.length === 0 ? undefined : null;
  }

  const normalized = value.trim();
  if (normalized === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : null;
}
