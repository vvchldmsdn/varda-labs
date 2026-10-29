import { admittedContributionCostBasisKrw } from '../additional-contribution-cost-basis.ts';
import {parseSaleExclusionKeys} from '../additional-contribution-sale-exclusions.ts';
import type { getReadOnlyTenantPortfolioTargetPolicyModel } from "../../db/queries/portfolio-target-policy";
import type { getReadOnlyTenantAdditionalContributionPreviewForScope } from "../../db/queries/additional-contribution";
import type { TenantApprovedTargetPolicyReadResult } from "../../db/queries/target-policy";
import type { PortfolioStructureResult } from "../portfolio-structure";
import type { BetaContext } from "./navigation";
import type { PORTFOLIO_TARGET_POLICY } from "../portfolio-target-policy.ts";
import { portfolioStructureHoldingIdentityKey } from "../portfolio-structure-target-policy.ts";

export type TargetModel = Omit<Awaited<ReturnType<typeof getReadOnlyTenantPortfolioTargetPolicyModel>>, "policyValidation"> & {
 policyValidation: Readonly<{ status: string }>; targetPlanRead?: "v2_held_identity_v1";
 plannedTargetRows?: readonly BetaTargetRow[];
 plannedMaRows?: readonly {market:string;currency:string;ticker:string|null;currentPrice:number|null;priceSource:string|null;priceAsOf:string|null;priceFetchedAt:string|null}[];
};
export type ContributionPreview = Awaited<ReturnType<typeof getReadOnlyTenantAdditionalContributionPreviewForScope>>;
export type ReadyContribution = Extract<ContributionPreview, { status: "ready" }>;
export type BetaTargetRow = {
  plannedOnly?: true;
  key: string; account: string; market: string; currency: string; ticker: string | null; name: string;
  currentValueKrw: number; currentWeightPct: number; effectiveTargetPct: number | null; driftPct: number | null;
};
export type BetaTargetRead = {
  state: "ready" | "missing" | "blocked" | "partial" | "unavailable" | "unsupported";
  message: string;
  provenance: { scopeKey: string; serviceDate: string; startingWeightSource: string; policyValidationStatus: string;
    approvalRevision: number | null; policyVersion: string | null; effectiveServiceDate: string | null;
    universeHash: string | null; vectorHash: string | null } | null;
  projection: TargetModel["structureTargetProjection"] | null;
  rows: BetaTargetRow[]; maxDrift: BetaTargetRow | null;
};
export type BetaContributionRead = {
  selectionRows?: {key:string;label:string;detail:string}[];
  state: "idle" | "invalid" | "unsupported" | "blocked" | "unavailable" | "ready";
  message: string; inputKrw: number | null; requestKey: string; approvalRevision: number | null;
  result: ReadyContribution | null; blockers: string[];
  provenance: { source: "portfolio_target_policy" | "legacy_account_policy"; scopeKey: string; serviceDate: string;
    policyVersion: string; effectiveServiceDate: string; approvalRevision: number | null; universeHash: string; vectorHash: string;
    consistency: "before_after_read_match" } | null;
};
export type BetaPlanningRead = { targets: BetaTargetRead; contribution: BetaContributionRead };
export type ContributionInput = { state: "idle" | "invalid" | "ready"; amount: number | null; raw: string | string[] | undefined };
// The existing additional-contribution page caps user input at 100 billion KRW; this is a UI limit, not a new engine policy.
export function parseContributionInput(raw: string | string[] | undefined): ContributionInput {
  if (raw === undefined) return { state: "idle", amount: null, raw };
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) return { state: "invalid", amount: null, raw };
  const amount = Number(raw);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000_000 ? { state: "ready", amount, raw } : { state: "invalid", amount: null, raw };
}
export function unavailableTargets(message = "승인 목표 조회 실패"): BetaTargetRead {
  return { state: "unavailable", message, provenance: null, projection: null, rows: [], maxDrift: null };
}
export function initialContribution(context: BetaContext, input: ContributionInput): BetaContributionRead {
  const requestKey = JSON.stringify([context.scope, context.currency, input.raw ?? null,...(context.excludeSell!==undefined?[context.excludeSell]:[])]);
  const state = input.state === "invalid" ? "invalid" : context.currency !== "KRW" ? "unsupported" : input.state === "idle" ? "idle" : "unavailable";
  const message = state === "invalid" ? "양의 정수 KRW를 한 번만 입력해 주세요" : state === "unsupported" ? "추가 투자 계산은 KRW만 지원합니다" : state === "idle" ? "투자금을 입력한 뒤 계산해 주세요" : "추가 투자 조회 실패";
  return { state, message, inputKrw: input.amount, requestKey, approvalRevision: null, result: null, provenance: null, blockers: state === "invalid" ? ["invalid_cash_amount"] : [] };
}
function valuationVector(structure: PortfolioStructureResult) {
  return structure.holdingRows.map(row => [portfolioStructureHoldingIdentityKey(row), row.currentValueKrw, row.currentWeightPct, row.priceAsOf]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
export function targetFingerprint(model: TargetModel) {
  const policy = model.approvedPolicy.policy;
  // This is an observation-coherence check, not a database snapshot/transaction guarantee.
  return JSON.stringify([model.scope.key, model.serviceDate, model.status, model.policyValidation.status, model.startingWeightSource,
    model.targetPlanRead ?? null, model.exactPolicyUniverse, model.currentUniverseHash, policy && [policy.approvalRevision, policy.policyVersion, policy.effectiveServiceDate, policy.universeHash, policy.vectorHash],
    model.rows.map(row => [row.accountId, row.assetId, row.market, row.currency, row.ticker, row.targetWeightBps, row.currentValueKrw, row.costBasisKrw, row.maAssetClass, row.maRuleEnabled, row.assetType, row.accountCode]), model.plannedTargetRows ?? [], model.plannedMaRows ?? [], valuationVector(model.structure), model.structure.exclusions]);
}
export function legacyFingerprint(read: TenantApprovedTargetPolicyReadResult | null) {
  if (!read) return null;
  return JSON.stringify(read.status === "available" ? [read.status, read.policy.account, read.policy.policyId, read.policy.policyVersion, read.policy.effectiveServiceDate, read.policy.universeHash, read.policy.vectorHash, read.policy.vector] : [read.status]);
}
// This baseline reads v1 policy rows only. A newer revision can have rows in
// a different table; an empty v1 join does not prove failed persistence.
// Type-checked against the engine version without importing node:crypto into UI helpers.
const SUPPORTED_TARGET_POLICY_VERSION: typeof PORTFOLIO_TARGET_POLICY.version = "portfolio_target_policy_v1";
function unsupportedTargetPolicyVersion(model: TargetModel) {
  return model.approvedPolicy.status === "available" && model.approvedPolicy.policy.policyVersion !== SUPPORTED_TARGET_POLICY_VERSION && !(model.approvedPolicy.policy.policyVersion === "portfolio_target_policy_v2" && model.targetPlanRead === "v2_held_identity_v1");
}
export function adaptTargets(model: TargetModel, context: BetaContext, serviceDate: string, structure: PortfolioStructureResult): BetaTargetRead {
  const policy = model.approvedPolicy.policy;
  const provenance = { scopeKey: model.scope.key, serviceDate: model.serviceDate, startingWeightSource: model.startingWeightSource,
    policyValidationStatus: model.policyValidation.status, approvalRevision: policy?.approvalRevision ?? null, policyVersion: policy?.policyVersion ?? null,
    effectiveServiceDate: policy?.effectiveServiceDate ?? null, universeHash: policy?.universeHash ?? null, vectorHash: policy?.vectorHash ?? null };
  const base: BetaTargetRead = { state: "blocked", message: "승인 목표 근거 확인 필요", provenance, projection: model.structureTargetProjection, rows: [], maxDrift: null };
  if (model.scope.key !== context.scope || model.serviceDate !== serviceDate) return { ...base, message: "목표 조회 범위·기준일 불일치" };
  if (unsupportedTargetPolicyVersion(model)) return { ...base, state: "unsupported", message: "저장된 목표 정책 버전 읽기 미지원 · 저장 행 누락을 뜻하지 않습니다", projection: null };
  if (model.policyValidation.status === "missing") return { ...base, state: "missing", message: "승인 목표 없음 · 현재 비중은 목표가 아닙니다" };
  if (model.policyValidation.status !== "available" || model.startingWeightSource !== "approved_policy" || !policy || !model.exactPolicyUniverse || policy.effectiveServiceDate > serviceDate) return { ...base, message: "승인 목표 사용 보류 · " + model.policyValidation.status };
  if (JSON.stringify(valuationVector(model.structure)) !== JSON.stringify(valuationVector(structure))) return { ...base, message: "평가 관측이 달라 목표 비교를 보류합니다" };
  const rows = model.structure.holdingRows.map(row => ({ key: JSON.stringify([row.account, row.market, row.currency, row.ticker, row.name]),
    account: row.account, market: row.market, currency: row.currency, ticker: row.ticker, name: row.name,
    currentValueKrw: row.currentValueKrw, currentWeightPct: row.currentWeightPct, effectiveTargetPct: row.effectiveTargetPct, driftPct: row.driftPct }));
  rows.push(...(model.plannedTargetRows ?? []));
  const partial = model.structure.exclusions.length > 0 || model.structure.dataHealth.excludedHoldingCount > 0 || model.structure.dataHealth.missingPriceCount > 0 || model.structure.dataHealth.missingFxCount > 0 || model.structure.dataHealth.unsupportedCurrencyCount > 0 || model.structureTargetProjection.status === "partial" || model.status !== "ready";
  if (partial) return { ...base, state: "partial", message: "평가·목표 투영 일부 미확인 · 전체 편차 비교 보류", rows };
  if (model.structureTargetProjection.status !== "applied") return { ...base, message: "승인 목표 투영 실패 · " + model.structureTargetProjection.reason, rows };
  const candidates = rows.filter(row => row.effectiveTargetPct !== null && Number.isFinite(row.effectiveTargetPct) && row.driftPct !== null && Number.isFinite(row.driftPct) && Number.isFinite(row.currentWeightPct));
  const maxDrift = candidates.reduce<BetaTargetRow | null>((selected, row) => !selected || Math.abs(row.driftPct!) > Math.abs(selected.driftPct!) ? row : selected, null);
  return { ...base, state: "ready", message: "승인 목표 대비 현재 비중 · %p", rows, maxDrift };
}
function safeReadyPreview(preview: ReadyContribution): ReadyContribution {
  // Explicit boundary: no tenant owner IDs, query internals, auth or transport objects cross to the browser.
  return { status: preview.status, source: preview.source, scopeKey: preview.scopeKey, serviceDate: preview.serviceDate, policyVersion: preview.policyVersion,
    policyLabel: preview.policyLabel, effectiveServiceDate: preview.effectiveServiceDate,
    calculationPolicy: preview.calculationPolicy, modifierEvidence: preview.modifierEvidence, minimumExecutionEvidenceAvailable: preview.minimumExecutionEvidenceAvailable, calculationParameters: preview.calculationParameters, cashAmountKrw: preview.cashAmountKrw,
    currentPortfolioTotalKrw: preview.currentPortfolioTotalKrw, postTopupTotalKrw: preview.postTopupTotalKrw, totalTrimProceedsKrw: preview.totalTrimProceedsKrw,
    totalAvailableFundsKrw: preview.totalAvailableFundsKrw, totalBaseNeedKrw: preview.totalBaseNeedKrw, minimumExecutionTargetKrw: preview.minimumExecutionTargetKrw,
    minimumExecutionSatisfied: preview.minimumExecutionSatisfied, totalAllocatedKrw: preview.totalAllocatedKrw, residualCashKrw: preview.residualCashKrw,
    ma120Evidence: preview.ma120Evidence, blockers: [...preview.blockers], rows: preview.rows.map(row => ({
      accountCode: row.accountCode, accountName: row.accountName, name: row.name, assetType: row.assetType, market: row.market, currency: row.currency, ticker: row.ticker,
      action: row.action, currentValueKrw: row.currentValueKrw, costBasisKrw: row.costBasisKrw, unrealizedReturnPct: row.unrealizedReturnPct,
      currentWeightPct: row.currentWeightPct, targetWeightPct: row.targetWeightPct, allocationKey: row.allocationKey, driftRatioPct: row.driftRatioPct, strategicAllocationKrw: row.strategicAllocationKrw,
      trimReason: row.trimReason, trimAmountKrw: row.trimAmountKrw, postTrimValueKrw: row.postTrimValueKrw,
      maEffectiveMultiplier: row.maEffectiveMultiplier, maAdjustmentReason: row.maAdjustmentReason,
      effectiveTargetWeightPct: row.effectiveTargetWeightPct, baseNeedKrw: row.baseNeedKrw,
      rawAllocationKrw: row.rawAllocationKrw, allocationKrw: row.allocationKrw,
      postTopupValueKrw: row.postTopupValueKrw, postTopupWeightPct: row.postTopupWeightPct, ma120Evidence: row.ma120Evidence, modifierBreakdown: row.modifierBreakdown, ma120ReductionKrw: row.ma120ReductionKrw,
    })) };
}
export function adaptContribution({ preview, before, after, legacyBefore, legacyAfter, targets, context, serviceDate, input }: {
  preview: ContributionPreview; before: TargetModel; after: TargetModel; legacyBefore: TenantApprovedTargetPolicyReadResult | null;
  legacyAfter: TenantApprovedTargetPolicyReadResult | null; targets: BetaTargetRead; context: BetaContext; serviceDate: string; input: ContributionInput;
}): BetaContributionRead {
  const base = initialContribution(context, input);
  const blocked = (message: string, blockers: readonly string[]): BetaContributionRead => ({ ...base, state: "blocked", message, blockers: [...blockers] });
  if (input.state !== "ready" || context.currency !== "KRW") return base;
  if (targetFingerprint(before) !== targetFingerprint(after) || legacyFingerprint(legacyBefore) !== legacyFingerprint(legacyAfter)) return blocked("조회 중 정책·평가 근거가 변경되었습니다 · 다시 계산해 주세요", ["planning_basis_changed"]);
  if (unsupportedTargetPolicyVersion(before)) return { ...base, state: "unsupported", message: "이 목표 정책 버전은 현재 베타 계산에 연결되지 않았습니다", blockers: ["unsupported_target_policy_version"] };
  if (preview.status !== "ready") return blocked("추가 투자 계산 보류 · " + preview.blockers.join(" · "), preview.blockers);
  if (preview.scopeKey !== context.scope || preview.serviceDate !== serviceDate || preview.cashAmountKrw !== input.amount) return blocked("계산 범위·기준일·입력 불일치", ["planning_request_mismatch"]);
  if (before.structure.exclusions.length || JSON.stringify(valuationVector(before.structure)) !== JSON.stringify(valuationVector(after.structure))) return blocked("평가 근거 일부 미확인", ["planning_valuation_incomplete"]);
  const holdingValues: [string, number, number][] = before.structure.holdingRows.map(row => [portfolioStructureHoldingIdentityKey(row), row.currentValueKrw, row.currentWeightPct] as [string, number, number]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  // Only independently admitted planned-only rows may extend the valuation vector.
  // A missing/excluded current holding never becomes a zero-valued plan.
  holdingValues.push(...(before.plannedTargetRows ?? []).map(row=>[portfolioStructureHoldingIdentityKey(row),row.currentValueKrw,row.currentWeightPct] as [string, number, number]));
  holdingValues.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const previewValues: [string, number, number][] = preview.rows.map(row => [portfolioStructureHoldingIdentityKey({ ...row, market: row.market ?? "", currency: row.currency ?? "" }), row.currentValueKrw, row.currentWeightPct] as [string, number, number]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  // Both preserved engines derive weight as value / total * 100, but their
  // summation order may differ. Permit only floating-point arithmetic noise in
  // this derived ratio; identity, row count and every monetary value stay exact.
  const sameWeight = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) &&
    Math.abs(a-b) <= Math.max(1, Math.abs(a), Math.abs(b)) * Number.EPSILON * 8;
  const sameValuation = holdingValues.length === previewValues.length && holdingValues.every((row, i) => {
    const calculated = previewValues[i];
    return row[0] === calculated[0] && Number.isFinite(row[1]) && Number.isFinite(calculated[1]) &&
      row[1] === calculated[1] && sameWeight(row[2], calculated[2]);
  });
  if (!sameValuation) return blocked("계산과 현재 평가의 관측 근거 불일치", ["planning_valuation_mismatch"]);
  if (preview.source === "portfolio_target_policy") {
    const policy = before.approvedPolicy.policy;
    if (targets.state !== "ready" || !policy || preview.policyVersion !== policy.policyVersion || preview.effectiveServiceDate !== policy.effectiveServiceDate) return blocked("승인 정책과 계산 출처가 일치하지 않습니다", ["planning_policy_mismatch"]);
    const expected = before.rows.map(row => [portfolioStructureHoldingIdentityKey(row), row.targetWeightBps / 100, row.currentValueKrw, admittedContributionCostBasisKrw(row)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    const actual = preview.rows.map(row => [portfolioStructureHoldingIdentityKey({ ...row, market: row.market ?? "", currency: row.currency ?? "" }), row.targetWeightPct, row.currentValueKrw, row.costBasisKrw]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) return blocked("계산 종목·목표·평가 근거 불일치", ["planning_vector_mismatch"]);
  } else {
    const policy = legacyBefore?.status === "available" ? legacyBefore.policy : null;
    if (before.policyValidation.status !== "missing" || !policy || policy.policyVersion !== preview.policyVersion || policy.effectiveServiceDate !== preview.effectiveServiceDate || policy.effectiveServiceDate > serviceDate) return blocked("구형 계좌 정책 근거 확인 필요", ["legacy_policy_mismatch"]);
    const vector = policy.vector.map(row => [row.market, row.currency, row.ticker, row.targetWeightBps / 100]).sort();
    const actual = preview.rows.map(row => [row.market, row.currency, row.ticker, row.targetWeightPct]).sort();
    if (JSON.stringify(vector) !== JSON.stringify(actual)) return blocked("구형 계좌 정책 벡터 불일치", ["legacy_vector_mismatch"]);
  }
  const saleSelection=parseSaleExclusionKeys(context.excludeSell);
  const excludedIdentities=new Set(saleSelection.ok?saleSelection.keys.flatMap(key=>before.rows.filter(row=>row.accountId+":"+row.assetId===key).map(row=>portfolioStructureHoldingIdentityKey({...row,accountCode:row.accountCode,market:row.market??"",currency:row.currency??""}))):[]);
  if(!saleSelection.ok||excludedIdentities.size!==saleSelection.keys.length||preview.rows.some(row=>{
    const identity=portfolioStructureHoldingIdentityKey({...row,market:row.market??"",currency:row.currency??""});
    return excludedIdentities.has(identity)?row.trimAmountKrw!==0||row.trimReason!=="user_sale_excluded":row.trimReason==="user_sale_excluded";
  }))return blocked("매도 제외 조건과 계산 결과가 일치하지 않습니다",["planning_sale_exclusion_mismatch"]);
  // Verify engine invariants; never recalculate allocations, effective weights, or rounding.
  const sameMoney = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= Math.max(1, Math.abs(a), Math.abs(b)) * Number.EPSILON * 8;
  if (!sameMoney(preview.cashAmountKrw + preview.totalTrimProceedsKrw, preview.totalAvailableFundsKrw) || !sameMoney(preview.totalAllocatedKrw + preview.residualCashKrw, preview.totalAvailableFundsKrw) || !sameMoney(preview.rows.reduce((sum,row)=>sum+row.allocationKrw,0), preview.totalAllocatedKrw) || !sameMoney(preview.rows.reduce((sum,row)=>sum+row.trimAmountKrw,0), preview.totalTrimProceedsKrw)) return blocked("계산 결과 합계 검증 실패", ["planning_funding_invariant"]);
  const approved = before.approvedPolicy.policy;
  const legacy = legacyBefore?.status === "available" ? legacyBefore.policy : null;
  const approvalRevision = preview.source === "portfolio_target_policy" ? approved!.approvalRevision : null;
  const policyBasis = preview.source === "portfolio_target_policy" ? approved! : legacy!;
  return { ...base, state: "ready", message: "계산 결과 · 주문·저장 없음", approvalRevision, result: safeReadyPreview(preview), blockers: [],
    provenance: { source: preview.source, scopeKey: preview.scopeKey, serviceDate: preview.serviceDate,
      policyVersion: preview.policyVersion, effectiveServiceDate: preview.effectiveServiceDate, approvalRevision,
      universeHash: policyBasis.universeHash, vectorHash: policyBasis.vectorHash, consistency: "before_after_read_match" } };
}
