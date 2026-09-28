import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { etfMasters } from '@/db/schema';
import { loadUsablePortfolioFxRows } from '@/db/queries/portfolio-fx-rates';
import { loadTenantMarketRegimeRows } from '@/db/queries/tenant-market-regimes';
import { getReadOnlyTenantPortfolioRiskForScope } from '@/db/queries/portfolio-risk';
import { readAdditionalContributionPerformance } from '@/db/queries/additional-contribution-performance';
import { calculateRiskContribution } from '@/lib/portfolio-risk-derived-metrics';
import { calculateContributionFxOverlay, knownContributionEvidence, missingContributionEvidence, unavailableContributionModifiers, type ContributionEvidence, type ContributionFxExposure, type ContributionModifiers } from '@/lib/additional-contribution-modifiers';
import type { PortfolioAnalysisScope } from '@/lib/portfolio-analysis-scope';
import type { TenantContext } from '@/lib/session-resolver-contract';
import { runTenantReadTransaction } from '@/db/tenant-transaction-context';

type Row = { key:string; assetId?:string; currentValue:number; market:string|null; currency:string|null; ticker:string|null; name:string; category?:string|null };
export type ContributionModifierRead = { modifiers:ContributionModifiers; rows:Record<string,{ fxExposureType:ContributionFxExposure; riskContribution:ContributionEvidence<number> }> };
/** No provider/LLM calls. Shared FX and risk reads follow an authenticated owner scope. */
export async function readAdditionalContributionModifiers({tenantContext,scope,now,rows,reportingCurrency='KRW'}:{tenantContext:TenantContext;scope:PortfolioAnalysisScope;now:Date;rows:readonly Row[];reportingCurrency?:'KRW'|'USD'}):Promise<ContributionModifierRead> {
  const fallback=unavailableContributionModifiers();
  const asOf=now.toISOString(), today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(now);
  const [fxResult,regimeResult,riskResult,metadataResult,performanceResult,hedgeResult]=await Promise.allSettled([
    loadUsablePortfolioFxRows(600),loadTenantMarketRegimeRows(tenantContext),
    reportingCurrency==='KRW'?getReadOnlyTenantPortfolioRiskForScope({tenantContext,scope,now,window:90}):Promise.resolve(null),
    runTenantReadTransaction(tenantContext.ownerUserId,tx=>[tx.query('select id::text,category from assets where canonical_owner_user_id=$1::uuid and id=any($2::uuid[]) and archived_at is null',[tenantContext.ownerUserId,rows.flatMap(row=>row.assetId?[row.assetId]:[])])]),
    readAdditionalContributionPerformance({rows,reportingCurrency,now}),
    rows.some(row=>row.ticker) ? db.select({ticker:etfMasters.ticker,market:etfMasters.market,currency:etfMasters.currency,hedged:etfMasters.isCurrencyHedged})
      .from(etfMasters).where(and(eq(etfMasters.isActive,true),eq(etfMasters.isSample,false),inArray(etfMasters.ticker,rows.flatMap(row=>row.ticker?[row.ticker]:[])))) : Promise.resolve([]),
  ]);
  const metadata=metadataResult.status==='fulfilled'?new Map(metadataResult.value[0].map(row=>[String(row.id),typeof row.category==='string'?row.category:null])):new Map<string,string|null>();
  const projected=Object.fromEntries(rows.map(row=>[row.key,{fxExposureType:exposure({...row,category:row.category??metadata.get(row.assetId??'')},hedgeResult.status==='fulfilled' && hedgeResult.value.some(master=>master.hedged===true && master.ticker.trim().toUpperCase()===row.ticker?.trim().toUpperCase() && master.market.toLowerCase()===row.market?.toLowerCase() && master.currency.toUpperCase()===row.currency?.toUpperCase())),riskContribution:missingContributionEvidence('complete_current_weight_risk_missing') as ContributionEvidence<number>}]));
  let fx=fallback.fx,regime=fallback.regime;
  if(fxResult.status==='fulfilled') {
    const candidates=fxResult.value.filter(row=>row.rateDate<=today&&row.fetchedAt&&new Date(row.fetchedAt).getTime()<=now.getTime()&&row.source&&Number(row.usdKrw)>0).toSorted((a,b)=>b.rateDate.localeCompare(a.rateDate)||new Date(b.fetchedAt!).getTime()-new Date(a.fetchedAt!).getTime());
    const latest=candidates[0], seen=new Set<string>();
    const admitted=candidates.filter(row=>{if(row.source!==latest?.source||seen.has(row.rateDate))return false;seen.add(row.rateDate);return true;}).slice(0,252).reverse();
    const total=rows.reduce((sum,row)=>sum+row.currentValue,0);
    // Unknown exposure is not silently treated as domestic for the portfolio overlay.
    const classified=rows.every(row=>projected[row.key].fxExposureType!=='UNKNOWN');
    const usd=rows.reduce((sum,row)=>sum+row.currentValue*(projected[row.key].fxExposureType==='US_LISTED'?1:projected[row.key].fxExposureType==='KR_UNHEDGED_GLOBAL'?.5:0),0);
    const fresh=latest&&Date.parse(today)-Date.parse(latest.rateDate)<=3*86400000&&now.getTime()-new Date(latest.fetchedAt!).getTime()<=3*86400000;
    const calculation=fresh&&classified&&total>0?calculateContributionFxOverlay(admitted.map(row=>Number(row.usdKrw)),usd/total*100):null;
    fx=calculation?knownContributionEvidence(calculation,latest!.source!,asOf):missingContributionEvidence(!fresh?'fx_stale_or_missing':!classified?'portfolio_fx_exposure_unclassified':'fx_less_than_60_observations');
  }
  if(regimeResult.status==='fulfilled'&&scope.kind==='account') {
    const candidates=regimeResult.value.filter(row=>row.account===scope.accountCode&&row.regimeDate<=today).toSorted((a,b)=>b.regimeDate.localeCompare(a.regimeDate));
    const latest=candidates[0];
    const complete=latest&&['macro','portfolio','news'].every(key=>Array.isArray((latest.driversJson as Record<string,unknown>)[key])&&((latest.driversJson as Record<string,unknown>)[key] as unknown[]).length>0);
    if(complete&&candidates.filter(row=>row.regimeDate===latest.regimeDate).length===1&&Date.parse(today)-Date.parse(latest.regimeDate)<=3*86400000&&['안정','주의','경계'].includes(latest.label)&&[latest.regimeScore,latest.macroStressScore,latest.newsSentimentScore].every(value=>value!==null&&Number.isFinite(Number(value)))&&Date.parse(latest.updatedAt)<=now.getTime()) regime=knownContributionEvidence(latest.label as '안정'|'주의'|'경계','tenant_market_regime_daily',latest.updatedAt);
  }
  if(riskResult.status==='fulfilled'&&riskResult.value) {
    const risk=riskResult.value, instruments=risk.calculation.instruments, matrix=risk.calculation.portfolio?.correlationMatrix;
    const key=(row:{market:string|null;currency:string|null;ticker:string|null})=>`${row.market?.toLowerCase()}:${row.currency?.toUpperCase()}:${row.ticker?.trim().toUpperCase()}`;
    const values=instruments.map(instrument=>rows.filter(row=>key(row)===key(instrument)).reduce((sum,row)=>sum+row.currentValue,0));
    const total=values.reduce((a,b)=>a+b,0);
    const complete=risk.inputHealth.status==='ready'&&risk.provenance.usableReturnObservations>=90&&risk.provenance.excludedHoldingCount===0&&risk.provenance.lastServiceDate&&Date.parse(today)-Date.parse(risk.provenance.lastServiceDate)<=7*86400000&&rows.every(row=>instruments.some(instrument=>key(row)===key(instrument)))&&values.every(value=>value>0)&&matrix?.every(line=>line.every(value=>value!==null));
    if(complete&&matrix&&total>0) {
      const weights=values.map(value=>value/total),covariance=matrix.map((line,i)=>line.map((correlation,j)=>correlation!*instruments[i].volatilityDaily*instruments[j].volatilityDaily));
      const variance=weights.reduce((sum,wi,i)=>sum+weights.reduce((inner,wj,j)=>inner+wi*wj*covariance[i][j],0),0);
      const calculated=calculateRiskContribution({covariance,weights,portfolioVariance:variance,annualizationScale:Math.sqrt(252)});
      rows.forEach(row=>{const i=instruments.findIndex(instrument=>key(row)===key(instrument));const pct=calculated.rows[i]?.signedRiskContributionPct;if(pct!==null&&pct!==undefined&&Number.isFinite(pct))projected[row.key].riskContribution=knownContributionEvidence(pct/100*row.currentValue/values[i],'portfolio_risk_v1_current_weights_krw',asOf);});
    }
  }
  return { modifiers:{...fallback,fx,regime,fundingBasis:'KRW',eventScore:missingContributionEvidence('stored_news_sentiment_is_not_gyeol_bearish_adjusted_score'),performance:performanceResult.status==='fulfilled'?performanceResult.value:missingContributionEvidence('performance_history_read_failed')},rows:projected };
}
function exposure(row:Row,explicitHedged=false):ContributionFxExposure {
  if(row.market?.toLowerCase()==='us')return 'US_LISTED';
  // The catalog boolean defaults to false: only true is explicit hedge evidence.
  if(explicitHedged)return 'HEDGED';
  const name=`${row.name} ${row.ticker??''}`;
  const negative=/\bunhedged\b|\bnon[\s-]*hedged\b|\b(?:not|no)\s+hedg(?:ed|ing)\b|환\s*헤지\s*(?:안\s*함|미적용|없음)|환노출/gi;
  const unhedged=negative.test(name);
  const positive=/\(h\)|\bhedged\b|환\s*헤지/i.test(name.replace(negative,''));
  const uncertain=/환\s*헤지\s*(?:여부|미확인|불명)|\b(?:hedge|hedging)\s*(?:unknown|unspecified)\b/i.test(name);
  if(uncertain || (unhedged&&positive))return 'UNKNOWN';
  if(positive)return 'HEDGED';
  if(row.market?.toLowerCase()==='korea'&&['미국주식','선진국주식','신흥국주식','글로벌채권','원자재','금/귀금속'].includes(row.category??''))return 'KR_UNHEDGED_GLOBAL';
  // An explicit domestic category is evidence; a KRW quote by itself is not.
  if(row.market?.toLowerCase()==='korea'&&['국내주식','한국주식','국내채권'].includes(row.category??''))return 'DOMESTIC';
  return 'UNKNOWN';
}
