import type {BetaContext} from './navigation';
import {betaHref,betaReadHref} from './navigation';
import {eventDate,eventHref} from './event-contract';
import {historyRows} from './read-presentation';
import type {BetaView} from './read-contract';
export type HistorySelection={date:string;period:'1M'|'3M'|'6M'|'ALL';metric:'value'|'return'};
export type HistoryReturn=HistorySelection & {scope:string;currency:string;kind:'origin'|'direct';dateBasis?:'storage'};
const fields=['_historyDate','_historyPeriod','_historyMetric','_historyScope','_historyCurrency','_historyReturn'] as const;
export function parseHistoryReturn(search:URLSearchParams,context:BetaContext):HistoryReturn|'invalid'|null{
 if(!fields.some(k=>search.has(k)))return null;
 const values=fields.map(k=>search.getAll(k));if(values.some(v=>v.length!==1))return 'invalid';
 const [date,period,metric,scope,currency,kind]=values.map(v=>v[0]);
 if(!eventDate(date)||!['1M','3M','6M','ALL'].includes(period)||!['value','return'].includes(metric)||!['origin','direct'].includes(kind)||scope!==context.scope||currency!==context.currency||context.mode!=='domain')return 'invalid';
 const basis=search.getAll('_historyDateBasis');if(basis.length>1||(basis.length===1&&(basis[0]!=='storage'||kind!=='direct')))return 'invalid';
 return {...(basis[0]==='storage'?{dateBasis:'storage' as const}:{}),date,period:period as HistorySelection['period'],metric:metric as HistorySelection['metric'],scope,currency,kind:kind as HistoryReturn['kind']};
}
function withReturn(href:string,hint:HistoryReturn|'invalid'|null){const url=new URL(href,'https://beta.invalid');if(hint==='invalid')url.searchParams.set('_historyReturn','invalid');else if(hint){const values=[hint.date,hint.period,hint.metric,hint.scope,hint.currency,hint.kind];fields.forEach((k,i)=>url.searchParams.set(k,values[i]));if(hint.dateBasis)url.searchParams.set('_historyDateBasis',hint.dateBasis);}return url.pathname+url.search+url.hash;}
export function historyEventHref(context:BetaContext,date:string,epoch:string|null|undefined,selection:HistorySelection){return withReturn(eventHref(context,date,epoch),{...selection,scope:context.scope,currency:context.currency,kind:'origin'});}
export function continueEventHref(context:BetaContext,date:string|string[]|undefined,epoch:string|null|undefined,search:URLSearchParams){return withReturn(eventHref(context,date,epoch),parseHistoryReturn(search,context));}
export function historyReturnHref(context:BetaContext,date:unknown,epoch:string|null|undefined,search:URLSearchParams,dateBasis?:'storage'){const origin=parseHistoryReturn(search,context);const hint=origin??(eventDate(date)?{date:date as string,period:'ALL' as const,metric:'value' as const,scope:context.scope,currency:context.currency,kind:'direct' as const,...(dateBasis?{dateBasis}:{})}:'invalid');return withReturn(betaReadHref(betaHref('/beta/history',context)+'#history-evidence',epoch),hint);}
// These are untrusted display hints, never identity or access evidence. Validate
// against only the current authorized/fresh view; do not retain financial data.
export function resolveHistoryReturn(hint:HistoryReturn|'invalid'|null,view:BetaView):HistoryReturn|'invalid'|null{
 if(!hint||hint==='invalid'||hint.dateBasis!=='storage'||!view.domain||!['ready','partial'].includes(view.domain.historyState))return hint;
 const matches=[...new Set(view.history.filter(row=>(row.storageSnapshotDate??row.date)===hint.date).map(row=>row.date))];
 if(matches.length!==1)return hint;
 const {dateBasis,...rest}=hint;void dateBasis;return {...rest,date:matches[0]};
}
export function validateHistoryReturn(hint:HistoryReturn|'invalid'|null,view:BetaView){
 if(!hint)return 'none';if(hint==='invalid')return 'invalid';
 if(view.domain?.historyState==='loading')return 'loading';
 if(!view.domain||!['ready','partial'].includes(view.domain.historyState))return 'unavailable';
 hint=resolveHistoryReturn(hint,view) as HistoryReturn;
 if(hint.dateBasis==='storage'||!view.history.some(row=>row.date===hint.date))return 'missing';
 if(!historyRows(view,hint.period).some(row=>row.date===hint.date))return 'outside-period';
 return 'valid';
}
