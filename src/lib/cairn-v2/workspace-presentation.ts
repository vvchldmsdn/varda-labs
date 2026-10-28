/** Display-only route identity. Never normalizes or writes a navigation URL. */
export type WorkspacePresentation = { title: string; section: 'home' | 'assets' | 'analysis' | 'plans' | 'history'; menuLabel: string };
const pages: Record<string, [string, WorkspacePresentation['section']]> = {
 '/beta':['대시보드','home'],
 '/beta/history':['기록 / 히스토리','history'],
 '/beta/history/events':['기록 / 날짜별 이벤트','history'],
 '/beta/history/snapshots':['기록 / 저장된 평가','history'],
 '/beta/history/position-snapshots':['기록 / 저장된 종목 평가','history'],
 '/beta/portfolio/structure':['자산 / 포트 구조','assets'],
 '/beta/portfolio/holdings':['자산 / 저장 보유 근거','assets'],
 '/beta/portfolio/accounts':['자산 / 계좌 현황','assets'],
 '/beta/portfolio/accounts/manage':['자산 / 계좌 관리','assets'],
 '/beta/portfolio/holdings/manage':['자산 / 보유 관리','assets'],
 '/beta/portfolio/holdings/new':['자산 / 보유종목 추가','assets'],
 '/beta/portfolio/groups':['자산 / 범위 관리','assets'],
 '/beta/portfolio/targets':['자산 / 목표비중','assets'],
 '/beta/portfolio/ledger':['기록 / 거래·현금','history'],
 '/beta/plans':['계획 / 저장된 투자계획','plans'],
 '/beta/analysis':['분석 / 위험·분산','analysis'],
 '/beta/simulation':['분석 / 현재 보유 연구','analysis'],
 '/beta/etfs':['분석 / ETF 구성','analysis'],
 '/beta/investment-lab':['분석 / 과거 비교','analysis'],
};
const menuLabels = {home:'홈 메뉴',assets:'자산 작업 메뉴',analysis:'분석 작업 메뉴',plans:'계획 작업 메뉴',history:'기록 작업 메뉴'};
export function workspacePresentation(pathname: string, analysis?: unknown): WorkspacePresentation | null {
 const page=pages[pathname];if(!page)return null;
 const [title,section]=page;
 return {title:pathname==='/beta/analysis'&&analysis==='holdings'?'분석 / 집중·통화':title,section,menuLabel:menuLabels[section]};
}
export function isCurrentWorkspaceLink(pathname: string, analysis: unknown, href: string): boolean {
 try {const target=new URL(href,'http://beta.local');if(target.origin!=='http://beta.local'||target.pathname!==pathname)return false;
 if(pathname==='/beta/analysis'&&analysis!==undefined&&analysis!=='risk'&&analysis!=='holdings')return false;
 return pathname!=='/beta/analysis'||(target.searchParams.get('analysis')??'risk')===(analysis??'risk');
 } catch {return false;}
}
export function supportsExactFrontendChoice(pathname: string): boolean {
 return !['/beta/history/events','/beta/history/snapshots','/beta/history/position-snapshots'].includes(pathname);
}
