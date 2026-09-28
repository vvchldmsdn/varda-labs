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
import { createHash } from 'node:crypto';
import { readAdditionalContributionModifiers } from '@/db/queries/additional-contribution-modifiers';

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
  if (holdings.some(row => !model.rows.some(target => (target.heldAssetId ?? target.assetId) === row.id && target.accountId === row.accountId && target.currency === row.observation!.currency)) || model.rows.some(target=>target.heldAssetId!==null && !holdings.some(row=>row.id===(target.heldAssetId ?? target.assetId)))) return { status: "blocked", reason: "target_universe_changed" };
  const policy = model.approvedPolicy.policy;
  const currentAccounts = new Set([...holdings.map(row => row.accountId), ...evidence.current.positions.filter(row => row.kind === "cash" && row.observation?.source === "native_ledger_cash").map(row => row.accountId)]);
  // Evaluate native current quotes against the admitted historical series in that same currency/basis.
  const ma = await getReadOnlyTenantAdditionalContributionMa120Evidence({
    holdings: [...holdings.map(row => ({ market: row.market ?? "", ticker: row.ticker ?? null, currency: row.observation!.currency, currentPrice: Number(row.observation!.price), priceSource: row.observation!.source, priceAsOf: row.observation!.priceObservedAt ?? row.observation!.at })), ...(model.ma120HoldingRows ?? []).filter(row=>model.rows.some(target=>target.heldAssetId===null && target.market===row.market && target.currency===row.currency && target.ticker===row.ticker))], serviceDate, now,
  }).catch(() => null);
  const modifierRead=await readAdditionalContributionModifiers({tenantContext:tenant,scope,now,reportingCurrency:reporting,rows:model.rows.map(row=>({key:row.assetId,assetId:row.heldAssetId ?? undefined,currentValue:row.heldAssetId===null?0:Number(current.positions.find(value=>value.id===(row.heldAssetId??row.assetId))?.value),market:row.market,currency:row.currency,ticker:row.ticker,name:row.assetName}))});
  const context:Extract<NativeContributionContextResult,{status:'ready'}> = {
    status: "ready", scopeKey, scopeLabel: scope.label,
    policy: { version: policy.policyVersion, revision: policy.approvalRevision, universeHash: policy.universeHash, vectorHash: policy.vectorHash, effectiveServiceDate: policy.effectiveServiceDate },
    nativeSequences: Object.fromEntries(Object.entries(evidence.nativeSequences ?? {}).filter(([id]) => currentAccounts.has(id))), names: Object.fromEntries(model.rows.map(row => [row.assetId, row.assetName])),
    availableCash: evidence.current.positions.filter(row => row.kind === "cash" && row.observation && Decimal.from(row.observation.quantity).compare(0) > 0).map(row => ({ amount: row.observation!.quantity, currency: row.observation!.currency, at: evidence.current.at, source: row.observation!.source, kind: "native_cash", accountId: row.accountId })),
    input: {
      reportingCurrency: reporting, asOf: evidence.current.at, fx: evidence.fx, maxFxAgeMs: evidence.maxFxAgeMs,
      trimDriftThresholdPct: evidence.contributionPolicy.trimDriftThresholdPct, minimumExecutionRatioPct: evidence.contributionPolicy.minimumExecutionRatioPct,
      modifiers:modifierRead.modifiers,
      rows: model.rows.map(target => {
        const row = holdings.find(item => item.id === (target.heldAssetId ?? target.assetId));
        const observed = row?.observation;
        const trend = ma?.rows.find(item => item.instrumentKey === additionalContributionInstrumentKey(target));
        const rawCompatible = trend?.priceBasis === "private_kis_raw_close" && (target.heldAssetId===null || observed?.basis === "raw" && observed.source.startsWith("kis")) && isCurrency(target.currency);
        return {
          allocationKey: target.assetId, assetType: target.assetType ?? null, buyable: target.buyability === "buyable", targetWeightBps: target.targetWeightBps,
          ...modifierRead.rows[target.assetId],
          maAssetClass: additionalContributionMaAssetClass({ ...target, maAssetClass: target.maAssetClass ?? null }), maRuleEnabled: evidence.contributionPolicy.useTrendFilter && (target.maRuleEnabled ?? true),
          ma120Evidence: rawCompatible && trend ? { status: trend.status, distanceFromMaPct: trend.evidence?.distanceFromMaPct ?? null } : { status: "unavailable", distanceFromMaPct: null },
          ...(rawCompatible ? { maBasis: { priceCurrency: target.currency, averageCurrency: target.currency, priceBasis: "raw", averageBasis: "raw" } } : {}),
          metadata: { accountId: target.accountId, name: target.assetName, ticker: target.ticker, market: target.market, maEvidence: trend?.evidence ?? null },
          value: { amount: observed ? Decimal.from(observed.quantity).mul(observed.price).toExactString() : "0", currency: isCurrency(target.currency)?target.currency:reporting, at: evidence.current.at, source: observed?.source ?? "unheld_target_zero" },
          cost: null, costLots: row?.costLots ?? null,
        };
      }),
    },
  };
  // Ignore the request clock; keep all selected prices, FX, targets, policy and evidence.
  const comparable=JSON.parse(JSON.stringify(context));
  delete comparable.input.asOf;
  for(const row of comparable.input.rows){delete row.value.at;if(row.metadata?.maEvidence)delete row.metadata.maEvidence.evaluatedAt;}
  for(const cash of comparable.availableCash)delete cash.at;
  for(const kind of ['fx'])if(comparable.input.modifiers?.[kind]?.status==='ready')delete comparable.input.modifiers[kind].asOf;
  for(const row of comparable.input.rows)if(row.riskContribution?.status==='ready')delete row.riskContribution.asOf;
  context.evidenceVersion=createHash('sha256').update(JSON.stringify(comparable)).digest('hex');
  return context;
}
