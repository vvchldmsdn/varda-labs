export const TENANT_LIVE_FX_SYNC_POLICY = Object.freeze({
  version: "tenant_live_fx_sync_v1",
  pair: "USD/KRW",
  provider: "er-api-open",
  freshnessMilliseconds: 5 * 60 * 1000,
} as const);

export type TenantLiveFxRefreshReason = "page_view" | "manual";

export type TenantLiveFxEvidence = Readonly<{
  usdKrw: string | number;
  status: string | null;
  fetchedAt: Date | string | null;
}>;

export type TenantLiveFxSyncPlan = Readonly<{
  hasUsdExposure: boolean;
  shouldRefresh: boolean;
  state: "not_required" | "fresh" | "refresh";
}>;

export function planTenantLiveFxSync({
  currencies,
  evidence,
  now = new Date(),
  reason,
}: {
  currencies: readonly string[];
  evidence: TenantLiveFxEvidence | null;
  now?: Date;
  reason: TenantLiveFxRefreshReason;
}): TenantLiveFxSyncPlan {
  const hasUsdExposure = currencies.some(
    (currency) => currency.trim().toUpperCase() === "USD",
  );

  if (!hasUsdExposure) {
    return Object.freeze({
      hasUsdExposure,
      shouldRefresh: false,
      state: "not_required" as const,
    });
  }

  const shouldRefresh = reason === "manual" || !isFreshFxEvidence(evidence, now);
  return Object.freeze({
    hasUsdExposure,
    shouldRefresh,
    state: shouldRefresh ? ("refresh" as const) : ("fresh" as const),
  });
}

function isFreshFxEvidence(
  evidence: TenantLiveFxEvidence | null,
  now: Date,
) {
  if (
    !evidence ||
    evidence.status?.trim().toLowerCase() !== "ok" ||
    Number(evidence.usdKrw) <= 0 ||
    !evidence.fetchedAt
  ) {
    return false;
  }

  const fetchedAt = new Date(evidence.fetchedAt).getTime();
  if (!Number.isFinite(fetchedAt)) return false;

  const age = now.getTime() - fetchedAt;
  return (
    age >= -60_000 &&
    age <= TENANT_LIVE_FX_SYNC_POLICY.freshnessMilliseconds
  );
}
