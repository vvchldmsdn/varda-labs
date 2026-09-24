import "server-only";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getTrackedCurrencyEvidence } from "@/db/queries/currency-tracked-portfolio";
import { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import { getReadOnlyTenantAdditionalContributionMa120Evidence } from "@/db/queries/additional-contribution-ma120";
import { additionalContributionInstrumentKey, additionalContributionMaAssetClass } from "@/lib/additional-contribution-policy-input";
import { buildTrackedCurrencyPortfolio } from "@/lib/currency-tracked-portfolio";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { Decimal, isCurrency, type Currency } from "@/lib/money";
import type { NativeContributionContextResult } from "@/lib/native-contribution-plan";
import type { TenantContext } from "@/lib/session-resolver-contract";

/** Target/MA metadata is reused. Legacy KRW valuations and average costs never cross this boundary. */
export async function readNativeContributionContext(tenant: TenantContext, scopeKey: string, reporting: Currency): Promise<NativeContributionContextResult> {
  const scoped = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext: tenant, scope: scopeKey });
  if (scoped.state !== "ready" || scoped.resolution.state !== "resolved") return { status: "blocked", reason: "scope_unavailable" };
  const scope = scoped.resolution.scope;
  const now = new Date(), serviceDate = resolveSnapshotCycle(now).snapshotDate;
  const [evidence, model] = await Promise.all([
    getTrackedCurrencyEvidence(tenant, scope, reporting, { asOf: now }),
    getReadOnlyTenantPortfolioTargetPolicyModel({ tenantContext: tenant, scope, serviceDate }),
  ]);
  const current = buildTrackedCurrencyPortfolio(evidence).current;
  if (!current?.complete || !evidence.ledgerComplete) return { status: "blocked", reason: "valuation_incomplete" };
  if (model.status !== "ready" || model.policyValidation.status !== "available" || !model.approvedPolicy.policy) return { status: "blocked", reason: "approved_targets_required" };
  const holdings = evidence.current.positions.filter(row => row.kind !== "cash" && row.observation && Decimal.from(row.observation.quantity).compare(0) > 0);
  if (holdings.length !== model.rows.length || holdings.some(row => !model.rows.some(target => target.assetId === row.id && target.accountId === row.accountId && target.currency === row.observation!.currency))) return { status: "blocked", reason: "target_universe_changed" };
  const policy = model.approvedPolicy.policy;
  const currentAccounts = new Set([...holdings.map(row => row.accountId), ...evidence.current.positions.filter(row => row.kind === "cash" && row.observation?.source === "native_ledger_cash").map(row => row.accountId)]);
  // Evaluate native current quotes against the admitted historical series in that same currency/basis.
  const ma = await getReadOnlyTenantAdditionalContributionMa120Evidence({
    holdings: holdings.map(row => ({ market: row.market ?? "", ticker: row.ticker ?? null, currency: row.observation!.currency, currentPrice: Number(row.observation!.price), priceSource: row.observation!.source, priceAsOf: row.observation!.priceObservedAt ?? row.observation!.at })), serviceDate, now,
  }).catch(() => null);
  return {
    status: "ready", scopeKey, scopeLabel: scope.label,
    policy: { version: policy.policyVersion, revision: policy.approvalRevision, universeHash: policy.universeHash, vectorHash: policy.vectorHash, effectiveServiceDate: policy.effectiveServiceDate },
    nativeSequences: Object.fromEntries(Object.entries(evidence.nativeSequences ?? {}).filter(([id]) => currentAccounts.has(id))), names: Object.fromEntries(holdings.map(row => [row.id, row.name])),
    availableCash: evidence.current.positions.filter(row => row.kind === "cash" && row.observation && Decimal.from(row.observation.quantity).compare(0) > 0).map(row => ({ amount: row.observation!.quantity, currency: row.observation!.currency, at: evidence.current.at, source: row.observation!.source, kind: "native_cash", accountId: row.accountId })),
    input: {
      reportingCurrency: reporting, asOf: evidence.current.at, fx: evidence.fx, maxFxAgeMs: evidence.maxFxAgeMs,
      trimDriftThresholdPct: evidence.contributionPolicy.trimDriftThresholdPct, minimumExecutionRatioPct: evidence.contributionPolicy.minimumExecutionRatioPct,
      rows: holdings.map(row => {
        const target = model.rows.find(item => item.assetId === row.id)!;
        const observed = row.observation!;
        const trend = ma?.rows.find(item => item.instrumentKey === additionalContributionInstrumentKey(target));
        const rawCompatible = trend?.priceBasis === "private_kis_raw_close" && observed.basis === "raw" && observed.source.startsWith("kis") && isCurrency(target.currency);
        return {
          allocationKey: row.id, assetType: target.assetType ?? null, buyable: target.buyability === "buyable", targetWeightBps: target.targetWeightBps,
          maAssetClass: additionalContributionMaAssetClass({ ...target, maAssetClass: target.maAssetClass ?? null }), maRuleEnabled: evidence.contributionPolicy.useTrendFilter && (target.maRuleEnabled ?? true),
          ma120Evidence: rawCompatible && trend ? { status: trend.status, distanceFromMaPct: trend.evidence?.distanceFromMaPct ?? null } : { status: "unavailable", distanceFromMaPct: null },
          ...(rawCompatible ? { maBasis: { priceCurrency: observed.currency, averageCurrency: observed.currency, priceBasis: "raw", averageBasis: "raw" } } : {}),
          metadata: { accountId: row.accountId, name: row.name, ticker: row.ticker, market: row.market, maEvidence: trend?.evidence ?? null },
          value: { amount: Decimal.from(observed.quantity).mul(observed.price).toExactString(), currency: observed.currency, at: evidence.current.at, source: observed.source },
          cost: null, costLots: row.costLots ?? null,
        };
      }),
    },
  };
}
