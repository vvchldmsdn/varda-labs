import type {BetaContext} from './navigation';
import {betaHref,betaReadHref} from './navigation';
import type {getSharedPortfolioTargetPolicyModel} from '../shared-backend/target-policy';
import type {getReadOnlyTenantPortfolioTargetPolicyModel as getCanonicalTargetModel} from '../../db/queries/portfolio-target-policy';
type Model=Awaited<ReturnType<typeof getCanonicalTargetModel>>;
type SelectedModel=Awaited<ReturnType<typeof getSharedPortfolioTargetPolicyModel>>;
export type TargetEditorRow=Pick<Model['rows'][number],'accountId'|'accountName'|'assetId'|'heldAssetId'|'assetName'|'assetType'|'market'|'currency'|'ticker'|'buyability'|'currentValueKrw'|'targetWeightBps'|'editorTargetWeightBps'>;
export type TargetEditorRead={context:BetaContext;state:'ready'|'blocked'|'unavailable'|'unauthorized';message:string;scopes:{key:string;label:string;detail:string}[];rows:readonly TargetEditorRow[];accounts:readonly {id:string;name:string;code:string}[];serviceDate:string|null;universeHash:string|null;approvalRevision:number;policyStatus:string;policyVersion:string|null;effectiveDate:string|null;startingWeightSource:string|null;queryKey?:string;readReceipt?:string;readEpoch?:string;readAt?:string};
export const targetEditorKey=(context:BetaContext)=>JSON.stringify(['target-editor-v2',context.mode,context.scope,context.currency]);
export const targetEditorGeneration=(context:BetaContext,epoch:string|null|undefined,receipt:string|undefined)=>JSON.stringify([targetEditorKey(context),epoch??'initial',receipt??'no-receipt']);
export function targetEditorHref(context:BetaContext,epoch?:string|null){return betaReadHref(betaHref('/beta/portfolio/targets',context)+'#target-editor',epoch);}
export function blankTargetEditor(context:BetaContext,state:TargetEditorRead['state'],message:string):TargetEditorRead{return {context,state,message,scopes:[],rows:[],accounts:[],serviceDate:null,universeHash:null,approvalRevision:0,policyStatus:'unavailable',policyVersion:null,effectiveDate:null,startingWeightSource:null};}
export function adaptTargetEditor(model:SelectedModel,base:TargetEditorRead):TargetEditorRead {
 if(!('selectableAccounts' in model))return {...base,state:'blocked',message:'v2 목표 편집을 지원하는 백엔드가 선택되지 않았습니다'};
 const policy=model.approvedPolicy.policy;
 return {...base,state:model.status==='ready'&&model.currentUniverseHash?'ready':'blocked',message:model.status==='ready'?'사용자가 정한 목표비중 · 승인 저장은 매매나 거래 기록이 아닙니다':'현재 구성의 목표 편집을 진행할 수 없습니다. 보유·계좌 근거를 확인해 주세요.',serviceDate:model.serviceDate,universeHash:model.currentUniverseHash,approvalRevision:policy?.approvalRevision??0,policyStatus:model.policyValidation.status,policyVersion:policy?.policyVersion??null,effectiveDate:policy?.effectiveServiceDate??null,startingWeightSource:model.startingWeightSource,
 accounts:model.selectableAccounts.map(({id,name,code})=>({id,name,code})),rows:model.rows.map(r=>({accountId:r.accountId,accountName:r.accountName,assetId:r.assetId,heldAssetId:r.heldAssetId,assetName:r.assetName,assetType:r.assetType,market:r.market,currency:r.currency,ticker:r.ticker,buyability:r.buyability,currentValueKrw:r.currentValueKrw,targetWeightBps:r.targetWeightBps,editorTargetWeightBps:r.editorTargetWeightBps}))};
}
