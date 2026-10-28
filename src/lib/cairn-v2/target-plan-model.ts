import { createHash } from "node:crypto";
import { isKrxGoldManualAssetCandidate } from "../market-data/manual-asset-price";
import { buildPortfolioTargetPolicyRecord, normalizePortfolioTargetUniverse, PORTFOLIO_TARGET_POLICY } from "../portfolio-target-policy";
import { projectPortfolioStructureEffectiveTargets } from "../portfolio-structure-target-policy";
import type { PortfolioAnalysisScopeTargets } from "../../db/queries/portfolio-analysis-scope-targets";
import type { PortfolioStructureHoldingRow } from "../portfolio-structure";
import type { TargetModel } from "./planning-contract";
import type { TenantPortfolioTargetPolicyRead } from "../../db/queries/tenant-target-policies";

// Read compatibility only. Hash serialization is identical to source 737b38f's
// v2 writer; weight validation and target projection still use the preserved engines.
export function targetPlanHashes(model: TargetModel, rows: TargetModel["rows"], effectiveServiceDate: string) {
  const identity = (row: TargetModel["rows"][number]) => ({ accountId: row.accountId, assetId: row.assetId,
    market: row.market, currency: row.currency, ticker: row.ticker, buyability: row.buyability });
  const hash = (value: unknown) => "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return { universeHash: hash({ hashVersion: PORTFOLIO_TARGET_POLICY.universeHashVersion,
    policyVersion: "portfolio_target_policy_v2", scopeKey: model.scope.key, rows: rows.map(identity) }),
  vectorHash: hash({ hashVersion: PORTFOLIO_TARGET_POLICY.vectorHashVersion, policyVersion: "portfolio_target_policy_v2",
    scopeKey: model.scope.key, effectiveServiceDate, rows: rows.map(row => ({ ...identity(row), targetWeightBps: row.targetWeightBps })) }) };
}
export const targetPlanIdentity=(r:{accountId:string;market:string;currency:string;ticker:string|null;assetId:string})=>JSON.stringify([r.accountId,r.market,r.currency,r.ticker??r.assetId]);
export type TargetPlanSupport={scope:PortfolioAnalysisScopeTargets;rows:readonly {planRowId:string;accountId:string;accountCode:string;accountName:string;assetType:string|null;hasHolding:boolean;currentPrice:number|null;priceSource:string|null;priceAsOf:string|null;priceFetchedAt:string|null}[]};
export function applyTargetPlanRead(base: TargetModel, read: TenantPortfolioTargetPolicyRead, support?: TargetPlanSupport): TargetModel {
  if (base.approvedPolicy.policy?.policyVersion !== "portfolio_target_policy_v2") return base;
  const marker = { targetPlanRead: "v2_held_identity_v1" as const };
  const blocked = (status: string): TargetModel => ({ ...base, ...marker, approvedPolicy: read,
    exactPolicyUniverse: false, policyValidation: { status }, startingWeightSource: "current_allocation_starting_point" });
  const original = base.approvedPolicy.policy, policy = read.policy;
  if (read.status !== "available" || !policy) return blocked(read.status);
  if (policy.policyVersion !== "portfolio_target_policy_v2" || original.approvalRevision !== policy.approvalRevision ||
      original.universeHash !== policy.universeHash || original.vectorHash !== policy.vectorHash ||
      original.effectiveServiceDate !== policy.effectiveServiceDate) return blocked("planning_basis_changed");
  const key=targetPlanIdentity;
  if (new Set(policy.rows.map(key)).size !== policy.rows.length || new Set(base.rows.map(key)).size !== base.rows.length) return blocked("duplicate_target_identity");
  const planned=policy.rows.filter(plan=>!base.rows.some(held=>key(held)===key(plan)));
  if(planned.length && !support)return blocked("target_plan_unheld_read_unsupported");
  if (base.rows.some(held=>!policy.rows.some(plan=>key(plan)===key(held)))) return blocked("universe_mismatch");
  const plannedRows: TargetModel["rows"][number][]=[];
  const plannedMaRows: NonNullable<TargetModel["plannedMaRows"]>[number][]=[];
  for(const plan of planned){
    const matches=support!.rows.filter(r=>r.planRowId===plan.assetId && r.accountId===plan.accountId);
    if(matches.length!==1)return blocked("target_plan_account_unavailable");
    const evidence=matches[0];
    const allowed=support!.scope.includesAllOwnedAccounts || support!.scope.wholeAccountIds.includes(plan.accountId) || base.rows.some(r=>r.accountId===plan.accountId);
    if(!allowed || evidence.hasHolding)return blocked("target_plan_outside_scope");
    // Match source v2 union admission. Zero means confirmed unheld, never missing valuation.
    const normalized=normalizePortfolioTargetUniverse([{...plan,assetType:plan.assetType??null,accountCode:evidence.accountCode,accountName:evidence.accountName,currentValueKrw:0}]);
    if(normalized.status!=="ready")return blocked("invalid_target_plan_row");
    const row=normalized.rows[0];
    if(row.buyability!==plan.buyability)return blocked("target_plan_buyability_unsupported");
    plannedRows.push({...row,assetType:evidence.assetType,costBasisKrw:null,maAssetClass:null,maRuleEnabled:true,targetWeightBps:plan.targetWeightBps,editorTargetWeightBps:plan.targetWeightBps});
    plannedMaRows.push({market:row.market,currency:row.currency,ticker:row.ticker,currentPrice:evidence.currentPrice,priceSource:evidence.priceSource,priceAsOf:evidence.priceAsOf,priceFetchedAt:evidence.priceFetchedAt});
  }
  const rows = policy.rows.map(row => {
    const held = base.rows.find(holding => key(holding) === key(row));
    if(!held)return plannedRows.find(p=>p.assetId===row.assetId)!;
    const buyability = isKrxGoldManualAssetCandidate({ ...held, name: held.assetName }) ? "buyable" as const : held.buyability;
    return { ...held, buyability, assetId: row.assetId, targetWeightBps: row.targetWeightBps };
  }).sort((a,b) => a.accountId.localeCompare(b.accountId) || a.assetId.localeCompare(b.assetId));
  if (policy.rows.some(row => rows.find(r => r.assetId === row.assetId)?.buyability !== row.buyability)) return blocked("target_plan_buyability_unsupported");
  const validated = buildPortfolioTargetPolicyRecord({ decisions: rows.map(row => ({assetId:row.assetId,targetWeightBps:row.targetWeightBps})),
    effectiveServiceDate: policy.effectiveServiceDate, scope: base.scope, universe: rows });
  if (validated.status !== "ready") return blocked("integrity_error");
  const hashes = targetPlanHashes(base, rows, policy.effectiveServiceDate);
  if (hashes.universeHash !== policy.universeHash || hashes.vectorHash !== policy.vectorHash) return blocked("integrity_error");
  if (policy.effectiveServiceDate > base.serviceDate) return blocked("not_effective");
  // Projection-only zero rows let the unchanged projection engine compute target/drift.
  // They never enter actual holdings, ring weights, valuation totals or price evidence.
  const zeroRows:PortfolioStructureHoldingRow[]=plannedRows.map(row=>({name:row.assetName,ticker:row.ticker,account:row.accountCode,market:row.market,currency:row.currency,
    assetType:row.assetType??null,groupName:"",quantity:0,currentPrice:0,currentValueKrw:0,currentWeightPct:0,rawAssetTargetPct:null,groupTargetPct:null,
    memberAllocationRatioPct:null,effectiveTargetPct:null,driftPct:null,targetPolicyStatus:"missing_target",priceEvidenceSource:"asset_current_price_fallback",priceSource:null,priceFetchedAt:null,priceAsOf:null}));
  const projection=projectPortfolioStructureEffectiveTargets({policyStatus:"available",structure:{...base.structure,holdingRows:[...base.structure.holdingRows,...zeroRows]},
    targets:rows.map(row=>({account:row.accountCode,assetName:row.assetName,assetType:row.assetType,market:row.market,currency:row.currency,ticker:row.ticker,targetWeightBps:row.targetWeightBps}))});
  const split=base.structure.holdingRows.length;
  const plannedTargetRows=projection.structure.holdingRows.slice(split).map((row,i)=>({plannedOnly:true as const,key:JSON.stringify(["plan",plannedRows[i].accountId,plannedRows[i].assetId]),
    account:row.account,market:row.market,currency:row.currency,ticker:row.ticker,name:row.name,currentValueKrw:row.currentValueKrw,currentWeightPct:row.currentWeightPct,effectiveTargetPct:row.effectiveTargetPct,driftPct:row.driftPct}));
  const structure={...projection.structure,holdingRows:projection.structure.holdingRows.slice(0,split),groupRows:planned.length?base.structure.groupRows:projection.structure.groupRows};
  const structureTargetProjection={status:projection.status,reason:projection.reason,coverage:{...projection.coverage,matchedHoldingCount:Math.max(0,projection.coverage.matchedHoldingCount-planned.length),...(planned.length?{plannedOnlyCount:planned.length}:{})}};
  const emptyOnly=base.universe.blockers.length===1&&base.universe.blockers[0]==="empty_universe";
  return {...base,...marker,status:emptyOnly&&planned.length?"ready":base.status,approvedPolicy:read,exactPolicyUniverse:true,policyValidation:{status:"available"},
    currentUniverseHash:hashes.universeHash,universe:{...base.universe,...(emptyOnly&&planned.length?{status:"ready" as const,blockers:[]}:{}),rows},rows,structure,structureTargetProjection,
    ...(planned.length?{plannedTargetRows,plannedMaRows}:{}),startingWeightSource:"approved_policy"};
}
