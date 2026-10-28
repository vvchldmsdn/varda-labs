import type { BetaContext } from './navigation';
import { betaReadHref } from './navigation';
import { canonicalBetaReadEpoch } from './read-freshness';
import { canonicalEtfMasterId, validEtfParams } from './etf-contract';

export type FrontendFeature = 'home' | 'history' | 'structure' | 'risk' | 'accounts' | 'holdings' | 'etfs' | 'simulation' | 'lab' | 'groups' | 'onboarding' | 'targets' | 'ledger' | 'plans';
type Value = string | string[] | undefined;
export type FrontendChoiceContext = BetaContext & {
  account?: Value; _betaRead?: Value; start?: Value;
  q?: Value; etfMasterId?: Value; ticker?: Value; asOfDate?: Value;
  returnUrl?: Value; redirect?: Value; next?: Value; url?: Value;
  action?: Value; mutation?: Value; ownerUserId?: Value; token?: Value;
};
export type FrontendChoiceRequest = {
  feature: FrontendFeature;
  current: 'beta' | 'original';
  context: FrontendChoiceContext;
  // Server-admitted keys are navigation context, not client-side authorization.
  // Each destination must still resolve the session and ownership independently.
  admittedScopeKeys: readonly string[];
};
export type FrontendChoiceResult = {
  state: 'ready' | 'selection-required' | 'unsupported' | 'invalid';
  originalHref: string | null; betaHref: string | null;
  message: string; notes: string[];
};

const routes: Record<FrontendFeature, {original: string; beta: string | null; scope: boolean}> = {
  ledger: {original:'/portfolio/ledger',beta:'/beta/portfolio/ledger',scope:false},
  plans: {original:'/plans',beta:'/beta/plans',scope:false},
  targets: {original:'/portfolio/targets',beta:'/beta/portfolio/targets',scope:true},
  home: {original:'/',beta:'/beta',scope:true},
  history: {original:'/history',beta:'/beta/history',scope:true},
  structure: {original:'/portfolio/structure',beta:'/beta/portfolio/structure',scope:true},
  risk: {original:'/portfolio/risk',beta:'/beta/analysis',scope:true},
  accounts: {original:'/portfolio/accounts',beta:'/beta/portfolio/accounts',scope:false},
  holdings: {original:'/portfolio/holdings',beta:'/beta/portfolio/holdings',scope:true},
  etfs: {original:'/etfs',beta:'/beta/etfs',scope:false},
  simulation: {original:'/simulation',beta:'/beta/simulation',scope:true},
  lab: {original:'/investment-lab',beta:'/beta/investment-lab',scope:true},
  groups: {original:'/portfolio/groups',beta:'/beta/portfolio/groups',scope:false},
  onboarding: {original:'/portfolio/holdings/new',beta:'/beta/portfolio/holdings/new',scope:false},
};
const canonicalScope = (value: unknown): value is string => typeof value === 'string' && (value === 'all' || /^(account|portfolio):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value));
const one = (value: Value) => value === undefined || typeof value === 'string';

export function resolveFrontendChoice(input: FrontendChoiceRequest): FrontendChoiceResult {
  const unavailable = (state: FrontendChoiceResult['state'], message: string): FrontendChoiceResult => ({state,originalHref:null,betaHref:null,message,notes:[]});
  if (!input || !Object.hasOwn(routes,input.feature) || !['beta','original'].includes(input.current)) return unavailable('unsupported','이 기능의 화면 전환은 지원하지 않습니다');
  const context=input.context, route=routes[input.feature];
  if (!context || !['KRW','USD'].includes(context.currency) || ['returnUrl','redirect','next','url','action','mutation','ownerUserId','token'].some(key=>context[key as keyof FrontendChoiceContext]!==undefined)) return unavailable('invalid','허용되지 않은 이동 조건 · 외부 주소나 작업 요청을 전달하지 않습니다');
  const notes: string[]=['기존 화면은 표시 통화 query를 지원하지 않습니다. 원본 통화·분석 기준을 유지합니다.'];
  if(context._betaRead!==undefined)notes.push('읽기 세대는 새 화면 링크에만 유지하며 로그인이나 권한 증거로 사용하지 않습니다.');
  const demo=input.current==='beta' && context.mode!=='domain';
  let scope: string;
  if (demo) {
    if (!['standard','empty','partial','large'].includes(context.fixture) || !['all','fixture-account-a','fixture-long-term'].includes(context.scope)) return unavailable('invalid','잘못된 예시 범위입니다');
    scope='all';
    notes.push('예시 범위는 기존 화면에 전달하지 않습니다. 기존 화면에서 실제 로그인·소유권을 다시 확인합니다.');
  } else {
    if (context.mode!==undefined && context.mode!=='domain') return unavailable('invalid','조회 모드가 올바르지 않습니다');
    if (!one(context.account)) return unavailable('invalid','중복된 기존 계좌 조건을 전달하지 않습니다');
    const legacy=context.account;
    if (!context.scope && legacy==='all') scope='all';
    else if (!canonicalScope(context.scope)) return unavailable('selection-required','조회 범위 확인 또는 선택이 필요합니다. 기존 계좌 코드를 전체 범위로 바꾸지 않습니다.');
    else scope=context.scope;
    if (legacy && legacy!=='all' && !scope.startsWith('account:')) return unavailable('selection-required','기존 계좌 코드에 대응하는 소유 계좌 범위를 먼저 확인해 주세요.');
    if (legacy==='all' && scope!=='all') return unavailable('invalid','기존 전체 계좌 조건과 선택 범위가 다릅니다');
    if (!Array.isArray(input.admittedScopeKeys) || !input.admittedScopeKeys.includes(scope)) return unavailable('selection-required','서버에서 확인한 소유 조회 범위를 선택해 주세요.');
  }
  const betaQuery = new URLSearchParams(demo ? {scope:context.scope,currency:context.currency,fixture:context.fixture} : {mode:'domain',scope,currency:context.currency});
  const oldQuery = new URLSearchParams(route.scope ? {scope} : {});
  if(input.feature==='ledger'||input.feature==='plans')notes.push('원장·저장 계획은 로그인한 본인의 전체 관리 자료를 다시 확인합니다. 미제출 입력은 화면 전환으로 전달하지 않습니다.');
  if (input.feature==='accounts'||input.feature==='groups') notes.push('기존 관리 화면은 본인 전체 계좌·그룹을 표시하며 상단 선택 범위로 목록을 제한하지 않습니다.');
  if (input.feature==='onboarding') notes.push('기존 신규 보유 화면은 소유 계좌 목록을 다시 읽습니다. 미제출 입력은 화면 전환에 전달하지 않습니다.');
  if (input.feature==='risk') {
    if (context.window!==undefined && (typeof context.window!=='string'||!['30','90','252'].includes(context.window))) return unavailable('invalid','지원되는 위험 분석 기간을 확인해 주세요');
    if (typeof context.window==='string') {oldQuery.set('window',context.window);betaQuery.set('window',context.window)}
    betaQuery.set('analysis','risk');
  }
  if (input.feature==='simulation') {
    if (context.horizon!==undefined && (typeof context.horizon!=='string'||!['63','126'].includes(context.horizon))) return unavailable('invalid','지원되는 관측 기간을 확인해 주세요');
    if (typeof context.horizon==='string') {oldQuery.set('horizon',context.horizon);betaQuery.set('horizon',context.horizon)}
    if (!copyDate(context.end,'end',oldQuery,betaQuery)) return unavailable('invalid','연구 기준일 형식이 올바르지 않습니다');
    notes.push('기존 시뮬레이션 화면은 진입 시 여러 연구를 읽고 계산합니다. 새 화면은 조건 확인 후 명시적으로 실행합니다.');
  }
  if (input.feature==='lab') {
    if ((context.start===undefined)!==(context.end===undefined) || !copyDate(context.start,'start',oldQuery,betaQuery) || !copyDate(context.end,'end',oldQuery,betaQuery) || (typeof context.start==='string'&&typeof context.end==='string'&&context.start>context.end)) return unavailable('invalid','과거 비교 시작일과 종료일을 함께 확인해 주세요');
    notes.push('기존 과거 비교 화면은 진입 시 여러 분석을 읽고 계산합니다. 새 화면으로 실행 요청을 자동 전달하지 않습니다.');
  }
  if (input.feature==='etfs') {
    const params={mode:'domain',scope,currency:context.currency,q:context.q,etfMasterId:context.etfMasterId,ticker:context.ticker,asOfDate:context.asOfDate};
    if (!validEtfParams(params)) return unavailable('invalid','ETF 선택·검색·저장 날짜를 확인해 주세요');
    for (const key of ['q','etfMasterId','ticker','asOfDate'] as const) if(typeof context[key]==='string') {
      const value=key==='etfMasterId'?canonicalEtfMasterId(context[key])!:context[key];
      oldQuery.set(key,value);betaQuery.set(key,value);
    }
    notes.push('ETF는 저장 구성 참고 자료입니다. 기존 화면의 선택 정책과 새 화면의 미선택 상태는 다를 수 있습니다.');
  }
  if (input.feature==='history') notes.push('전환 링크는 조회 범위만 옮깁니다. 서로 다른 날짜·기간·보기 계약을 같은 선택으로 추정하지 않습니다.');
  if (!route.beta) notes.push('새 화면의 해당 관리 기능은 아직 연결되지 않았습니다.');
  const originalHref=route.original+(oldQuery.size?'?'+oldQuery:'');
  let betaHref: string|null=null;
  if(route.beta && (!demo || ['home','history','structure'].includes(input.feature))) {
    const epoch=canonicalBetaReadEpoch(context._betaRead);
    if(context._betaRead!==undefined&&!epoch) return unavailable('invalid','읽기 세대 형식이 올바르지 않습니다');
    betaHref=betaReadHref(route.beta+'?'+betaQuery,epoch);
  }
  if(demo&&route.beta&&!betaHref)notes.push('이 새 작업 화면은 domain 읽기만 지원하며 예시 결과로 대체하지 않습니다.');
  return {state:'ready',originalHref,betaHref,message:'같은 기존 backend를 이용하는 화면 전환 준비 · 각 화면에서 권한을 다시 확인합니다',notes};
}
function copyDate(value: Value,key: string,...queries: URLSearchParams[]) {
  if(value===undefined)return true;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00.000Z'))||new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)!==value)return false;
  for(const query of queries)query.set(key,value);
  return true;
}
