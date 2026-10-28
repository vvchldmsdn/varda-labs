import type {InvestmentLabAnalysisScopeEvidence} from '../investment-lab-analysis-scope';
import type {getReadOnlyTenantInvestmentLabCounterfactualForScope} from '../../db/queries/investment-lab';
import {resolveInvestmentLabPeriodSelection} from '../investment-lab-period-selection';
import {domainContext,domainQueryValid} from './read-service';
import {betaReadHref,type BetaContext} from './navigation';
export type LabParams=Record<string,string|string[]|undefined>;
type Source=Awaited<ReturnType<typeof getReadOnlyTenantInvestmentLabCounterfactualForScope>>;
export function adaptLab(source:Source,evidence:InvestmentLabAnalysisScopeEvidence){const m=source.model,r=m.returnEstimate,f=source.fundingPreflight;return {
 scopeEvidence:{includedAccountCodes:evidence.includedAccountCodes,engineAccount:evidence.engineAccount,policy:evidence.policy,excluded:evidence.fountAdjustment},
 period:source.period,observedHistory:source.observedHistory,
 comparison:{status:m.status,scenario:m.scenario,summary:m.summary,rows:m.rows,coverage:m.coverage,blockers:m.blockers,sourceAuthority:m.sourceAuthority,
 returns:r?{status:r.status,actualReturn:r.actualReturn,scenarioReturn:r.scenarioReturn,differencePercentagePoints:r.differencePercentagePoints,method:r.method,basis:r.basis,blockers:r.blockers}:null},
 funding:{policy:f.policy,accountScope:f.accountScope,actual:f.aggregateScenarios.actual,kodex200:f.aggregateScenarios.kodex200,accounts:f.accountRows.map(a=>({account:a.account,actual:a.scenarios.actual,kodex200:a.scenarios.kodex200}))},
 fount:source.fountScopeAdjustment,
 };}
export type LabModel=ReturnType<typeof adaptLab>;
export type LabState='idle'|'loading'|'ready'|'partial'|'blocked'|'invalid'|'unavailable'|'unauthorized';
export type LabRead={context:BetaContext;state:LabState;message:string;queryKey:string;model:LabModel|null;scopes:Array<{key:string;label:string;detail:string}>;readReceipt?:string;readEpoch?:string;readAt?:string};
const fields=['mode','scope','currency','account','fixture','start','end','run','_betaRead','kodexWeight','basketAnchor'] as const;
export function labParams(search:URLSearchParams):LabParams{const p:LabParams={};for(const k of fields){const a=search.getAll(k);if(a.length)p[k]=a.length===1?a[0]:a;}return p;}
export function labKey(p:LabParams){return JSON.stringify(fields.filter(k=>k!=='_betaRead').map(k=>p[k]));}
export function labPeriodRequest(p:LabParams){return p.start===undefined&&p.end===undefined?undefined:{startServiceDate:p.start,endServiceDate:p.end};}
export function validLabParams(p:LabParams){if(!domainQueryValid(p)||p.kodexWeight!==undefined||p.basketAnchor!==undefined||(p.run!==undefined&&p.run!=='1'))return false;
 const request=labPeriodRequest(p);if(!request)return true;
 const selection=resolveInvestmentLabPeriodSelection({request,availableServiceDates:[]});
 return selection.status!=='invalid';
}
export function labContext(p:LabParams):BetaContext{const c=domainContext(p);return {mode:c.mode,scope:c.scope,currency:c.currency,fixture:c.fixture};}
export function blankLab(p:LabParams,state:LabState,message:string):LabRead{return {context:labContext(p),queryKey:labKey(p),state,message,model:null,scopes:[]};}
export function labHref(context:BetaContext,p:LabParams,epoch?:string|null){const q=new URLSearchParams({mode:'domain',scope:context.scope,currency:context.currency});for(const k of ['start','end','run'] as const){const v=p[k];if(v!==undefined)for(const s of Array.isArray(v)?v:[v])q.append(k,s);}return betaReadHref('/beta/investment-lab?'+q+'#lab-comparison',epoch);}
export const labNumber=(v:number|null|undefined)=>v==null?'—':String(v);
export function labVisible(read:LabRead,key:string,pending:boolean,blocked:boolean){return !pending&&!blocked&&read.queryKey===key;}
