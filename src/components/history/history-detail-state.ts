export type HistoryDetailPanel = "records" | "raw" | null;
export type HistoryDetailParams = Record<string, string | string[] | undefined>;
export const HISTORY_RAW_PAGE_SIZE = 50;

export function normalizeHistoryDetail(params: HistoryDetailParams): HistoryDetailPanel {
  if (params.detail === "records" || params.detail === "raw") return params.detail;
  // Keep existing bookmarked position/comparison URLs usable.
  if (params.detail === undefined && [params.positionDate, params.comparisonFrom, params.comparisonTo].some(Boolean)) return "raw";
  return null;
}

export function historyEvidencePage<T>(rows: readonly T[], requested: string | string[] | undefined) {
  const parsed = typeof requested === "string" && /^\d+$/.test(requested) ? Number(requested) : 1;
  const pageCount = Math.max(1, Math.ceil(rows.length / HISTORY_RAW_PAGE_SIZE));
  const page = Number.isSafeInteger(parsed) ? Math.min(pageCount, Math.max(1, parsed)) : 1;
  const start = (page - 1) * HISTORY_RAW_PAGE_SIZE;
  return { rows: rows.slice(start, start + HISTORY_RAW_PAGE_SIZE), page, pageCount, total: rows.length, start: rows.length ? start + 1 : 0, end: Math.min(rows.length, start + HISTORY_RAW_PAGE_SIZE) };
}

export function historyDetailHref(query: string, changes: Record<string, string | null>) {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return `/history${params.size ? `?${params}` : ""}`;
}
