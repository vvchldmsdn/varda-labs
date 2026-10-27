import { Decimal } from './money.ts';

/** Gyeol's connected v10 formulas, with explicit missing-data and funding boundaries. */
export type ContributionEvidence<T> =
  | Readonly<{ status: 'ready'; value: T; source: string; asOf: string }>
  | Readonly<{ status: 'unavailable' | 'not_applicable'; reason: string }>;
export type ContributionFxExposure = 'US_LISTED' | 'KR_UNHEDGED_GLOBAL' | 'DOMESTIC' | 'HEDGED' | 'UNKNOWN';
export type ContributionModifiers = Readonly<{
  fundingBasis: 'KRW' | 'unsupported';
  fx: ContributionEvidence<{ multiplier: number; hot: boolean; observationCount: number; percentileLookback?: number; ma120Available?: boolean }>;
  regime: ContributionEvidence<'안정' | '주의' | '경계'>;
  eventScore: ContributionEvidence<number>;
  performance: ContributionEvidence<{ alpha90Pct: number; alpha252Pct: number; mddPct: number }>;
}>;
export const missingContributionEvidence = (reason: string): ContributionEvidence<never> => ({ status: 'unavailable', reason });
export function unavailableContributionModifiers(): ContributionModifiers {
  return { fundingBasis: 'unsupported', fx: missingContributionEvidence('fx_history_missing'), regime: missingContributionEvidence('regime_missing'), eventScore: missingContributionEvidence('news_score_missing'), performance: missingContributionEvidence('matched_alpha_missing') };
}
export function knownContributionEvidence<T>(value: T, source: string, asOf: string): ContributionEvidence<T> {
  return { status: 'ready', value, source, asOf };
}
type Multiplier = { value: number; status: 'ready' | 'unavailable' | 'not_applicable'; reason?: string };
const clamp = (v: number, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));
const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;
function validEvidence<T>(v: ContributionEvidence<T> | undefined): v is Extract<ContributionEvidence<T>, {status:'ready'}> { return !!v && v.status === 'ready' && !!v.source?.trim() && Number.isFinite(Date.parse(v.asOf)); }
function multiplier<T>(evidence: ContributionEvidence<T> | undefined, select: (v:T)=>number|null): Multiplier {
  if (!validEvidence(evidence)) return { value:1, status: evidence?.status === 'not_applicable' ? 'not_applicable' : 'unavailable', reason: evidence && 'reason' in evidence ? evidence.reason : 'evidence_missing' };
  const value = select(evidence.value);
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 1 ? { value, status:'ready' } : { value:1, status:'unavailable', reason:'invalid_evidence' };
}
export function resolveContributionMultipliers(input: { modifiers: ContributionModifiers; exposure?: ContributionFxExposure; riskContribution?: ContributionEvidence<number>; targetFraction: number }) {
  const { modifiers: m, exposure } = input;
  const strength = exposure === 'US_LISTED' ? 1 : exposure === 'KR_UNHEDGED_GLOBAL' ? 0.5 : 0;
  let fx: Multiplier;
  if (exposure === 'DOMESTIC' || exposure === 'HEDGED') fx = { value:1, status:'not_applicable' };
  else if (m.fundingBasis !== 'KRW') fx = { value:1, status:'unavailable', reason:'funding_currency_policy_undefined' };
  else if (!exposure || exposure === 'UNKNOWN') fx = { value:1, status:'unavailable', reason:'exposure_unclassified' };
  else fx = multiplier(m.fx, v => Number.isFinite(v.multiplier) && v.multiplier >= 0.55 && v.multiplier <= 1 && v.observationCount >= 60 ? 1 - (1-v.multiplier)*strength : null);
  const rc = multiplier(input.riskContribution, value => {
    if (!Number.isFinite(value) || !Number.isFinite(input.targetFraction) || input.targetFraction <= 0) return null;
    // Compare the decimal inputs directly: binary division makes .30/.20 fall below 1.5.
    // No tolerance or rounding may promote a genuinely below-threshold ratio.
    try {
      const risk = Decimal.from(value), target = Decimal.from(input.targetFraction);
      return risk.compare(target.mul('1.5')) >= 0 ? .85 : risk.compare(target.mul('1.2')) >= 0 ? .9 : 1;
    } catch { return null; }
  });
  const regime = multiplier(m.regime, value => ({ 안정:1, 주의:.85, 경계:.7 })[value] ?? null);
  const event = multiplier(m.eventScore, score => Number.isFinite(score) && score >= 0 && score <= 100 ? score < 40 ? .9 : score < 55 ? .95 : 1 : null);
  const performance = multiplier(m.performance, v => [v.alpha90Pct,v.alpha252Pct,v.mddPct].every(Number.isFinite) && v.mddPct >= -100 && v.mddPct <= 0 ? v.alpha90Pct < 0 && v.alpha252Pct < 0 && v.mddPct <= -10 ? .9 : 1 : null);
  return { fx, rc, regime, event, performance, penaltyMult:round(fx.value*rc.value*regime.value*event.value*performance.value,4) };
}
export function contributionMinimumRatio(modifiers: ContributionModifiers, configuredPct: number): number | null {
  if (!validEvidence(modifiers.regime) || modifiers.fundingBasis !== 'KRW' || !validEvidence(modifiers.fx)) return null;
  const byRegime = ({ 안정:85, 주의:65, 경계:40 })[modifiers.regime.value];
  if (byRegime === undefined) return null;
  const hot = modifiers.fundingBasis === 'KRW' && validEvidence(modifiers.fx) && modifiers.fx.value.hot;
  return clamp((Math.min(configuredPct,byRegime) - (hot ? 10 : 0))/100);
}
export function contributionFxPriority(exposure?: ContributionFxExposure) {
  return exposure === 'DOMESTIC' || exposure === 'HEDGED' ? 1 : exposure === 'KR_UNHEDGED_GLOBAL' ? .5 : 0;
}

/** Daily observations are deduplicated and admitted by the caller; no invented MA120. */
export function calculateContributionFxOverlay(series: readonly number[], usdExposurePct: number) {
  if (series.length < 60 || series.some(value=>!Number.isFinite(value) || value<=0) || !Number.isFinite(usdExposurePct) || usdExposurePct<0 || usdExposurePct>100) return null;
  const spot=series.at(-1)!;
  const average=(n:number)=>series.length>=n ? series.slice(-n).reduce((a,b)=>a+b,0)/n : null;
  const averages=[average(20),average(60),average(120)];
  const lookback=series.slice(-252), percentile=lookback.filter(value=>value<=spot).length/lookback.length*100;
  const percentileMult=percentile>=85?.72:percentile>=70?.84:percentile>=55?.94:1;
  const above=averages.filter(value=>value!==null&&spot>value).length;
  const trendMult=[1,.96,.89,.8][above];
  const premium=Math.max(...averages.filter((value):value is number=>value!==null).map(value=>(spot-value)/value*100));
  const stretchMult=premium>=5?.8:premium>=3?.88:premium>=1.5?.94:premium>=.5?.98:1;
  const exposureMult=usdExposurePct>=35?.88:usdExposurePct>=25?.93:usdExposurePct>=15?.97:1;
  const result=round(clamp(percentileMult*trendMult*stretchMult*exposureMult,.55,1),3);
  return { multiplier:result,hot:result<=.75,observationCount:series.length,percentileLookback:lookback.length,ma120Available:series.length>=120,percentile,percentileMult,trendMult,stretchMult,exposureMult };
}
