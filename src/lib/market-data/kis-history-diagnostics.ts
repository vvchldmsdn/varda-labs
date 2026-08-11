import type {
  HistoricalPriceFailure,
  HistoricalPriceResult,
} from "@/lib/market-data/providers/types";

export type KisHistoryProviderDiagnostics = {
  requestCount: number;
  fetchedRowCount: number;
  providerFailureCount: number;
  failureCodes: Partial<
    Record<HistoricalPriceFailure["code"], number>
  >;
};

export function summarizeKisHistoryProviderResult(
  result: Pick<
    HistoricalPriceResult,
    "requestCount" | "rows" | "failures"
  >,
): KisHistoryProviderDiagnostics {
  const counts = new Map<HistoricalPriceFailure["code"], number>();

  for (const failure of result.failures) {
    counts.set(failure.code, (counts.get(failure.code) ?? 0) + 1);
  }

  return {
    requestCount: result.requestCount,
    fetchedRowCount: result.rows.length,
    providerFailureCount: result.failures.length,
    failureCodes: Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

export function formatKisHistoryNoRowsError(
  diagnostics: KisHistoryProviderDiagnostics,
) {
  const failureSummary = Object.entries(diagnostics.failureCodes)
    .map(([code, count]) => `${code}:${count}`)
    .join(",");

  return failureSummary
    ? `KIS history returned no cacheable rows (${failureSummary})`
    : "KIS history returned no cacheable rows";
}

export function formatKisHistoryIncompleteError(input: {
  coveredCount: number;
  targetCount: number;
  failures: readonly HistoricalPriceFailure[];
}) {
  const failureSummary = input.failures
    .map((failure) => `${failure.instrumentKey}:${failure.code}`)
    .sort((left, right) => left.localeCompare(right))
    .join(",");
  const detail = failureSummary ? ` [${failureSummary}]` : "";

  return `KIS history preview incomplete: covered=${input.coveredCount}/${input.targetCount}, failures=${input.failures.length}${detail}`;
}
