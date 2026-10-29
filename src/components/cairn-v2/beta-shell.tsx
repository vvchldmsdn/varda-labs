"use client";
import { Button as CairnButton, Checkbox as CairnCheckbox, Field as CairnField, Input as CairnInput, PageTitle as CairnPageTitle, Select as CairnSelect, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";

import { RecoveryJourneyLink as Link } from '@/components/recovery/recovery-return';
import {remainingWorkspaceHref} from "@/lib/cairn-v2/remaining-workspace-contract";
import {targetEditorHref} from '@/lib/cairn-v2/target-editor-contract';
import {ownedManagementHref} from '@/lib/cairn-v2/owned-management-contract';
import {managementHref} from "@/lib/cairn-v2/account-management-contract";
import { FrontendChoice } from "./frontend-choice";
import type { FrontendFeature } from "@/lib/cairn-v2/frontend-choice";
import {accountsHref} from "@/lib/cairn-v2/account-contract";
import {holdingsHref} from "@/lib/cairn-v2/holding-contract";
import {eventHref} from "@/lib/cairn-v2/event-contract";
import {snapshotHref} from "@/lib/cairn-v2/snapshot-contract";
import { usePathname, useRouter } from "next/navigation";
import { isCurrentWorkspaceLink, supportsExactFrontendChoice, workspacePresentation } from "@/lib/cairn-v2/workspace-presentation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { betaReadHref, betaHref, originalHref, purposeDestinations, type BetaContext } from "@/lib/cairn-v2/navigation";
import { retryReadNeeded, homeReadMessage } from "@/lib/cairn-v2/read-display";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { fixtureNotice, fixtureScopes } from "@/lib/cairn-v2/fixtures";
import { BetaDialog, type ExpansionOrigin } from "./beta-dialog";
import { useBetaPreferences, useBetaReadFreshness, useBetaExistingCrudAvailable } from "./beta-provider";
import { PortfolioRefreshButton } from '@/components/home/portfolio-refresh-button';
import styles from "./beta.module.css";
import tokens from "./ui/tokens.module.css";
import controls from "./workspace-controls.module.css";

/* eslint-disable @next/next/no-img-element -- Figma SVG assets retain their own root dimensions. */
export function BetaShell({ children, context, setContext, readView, workspace, originalPath = "/" }: {
  children: ReactNode; context: BetaContext; setContext: (value: BetaContext) => void;
  readView?: BetaView; workspace?: "history" | "structure" | "holdings" | "accounts" | "analysis" | "simulation" | "etfs" | "lab" | "groups" | "targets" | "ledger" | "plans"; originalPath?: string;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const presentation = workspacePresentation(pathname, context.analysis);
  const existingCrudAvailable = useBetaExistingCrudAvailable();
  const frontendFeature = ({"/portfolio/ledger":"ledger","/plans":"plans","/":"home","/history":"history","/portfolio/structure":"structure","/portfolio/risk":"risk","/portfolio/accounts":"accounts","/portfolio/holdings":"holdings","/etfs":"etfs","/simulation":"simulation","/investment-lab":"lab","/portfolio/groups":"groups","/portfolio/holdings/new":"onboarding","/portfolio/targets":"targets"} as Record<string, FrontendFeature>)[originalPath];
  const freshness = useBetaReadFreshness();
  const readHref = (href: string) => { const epoch = context.mode === "domain" ? freshness?.store.pendingEpoch() : undefined; return betaReadHref(href, epoch); };
  const [popover, setPopover] = useState<{kind: 'scope' | 'settings'; origin: ExpansionOrigin} | null>(null);
  const scopeOrigin = popover?.kind === 'scope' ? popover.origin : null;
  const settingsOrigin = popover?.kind === 'settings' ? popover.origin : null;
  const setScopeOrigin = (origin: ExpansionOrigin | null) => setPopover(origin ? {kind:'scope',origin} : null);
  const openSettings = (trigger: HTMLButtonElement) => setPopover({kind:'settings',origin:{rect:trigger.getBoundingClientRect(),trigger}});
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { rootRef.current?.setAttribute("data-beta-ready", "true"); }, []);
  const { reduceEffects, setReduceEffects } = useBetaPreferences();
  const scopes = context.mode === "domain" ? readView?.domain?.scopes ?? [] : fixtureScopes;
  const selectedScope = scopes.find((s) => s.key === context.scope) ?? { label: "범위 확인 전" };
  const subnav = workspace === "plans" ? [
    {label:"저장된 투자계획",href:remainingWorkspaceHref("plans",context),beta:true},
    {label:"추가 투자 계산",href:betaHref("/beta",context)+"#beta-contribution",beta:true},
    {label:"목표비중 관리",href:targetEditorHref(context),beta:true},
  ] : (workspace === "analysis" || workspace === "simulation" || workspace === "etfs" || workspace === "lab") ? [
    {label:"과거 비교",href:"/beta/investment-lab?"+new URLSearchParams({mode:"domain",scope:context.scope,currency:context.currency}),beta:true},
    {label:"ETF 구성",href:"/beta/etfs?"+new URLSearchParams({mode:"domain",scope:context.scope,currency:context.currency}),beta:true},
    {label:"위험·분산",href:betaHref("/beta/analysis",{...context,analysis:"risk"}),beta:true},
    {label:"집중·통화",href:betaHref("/beta/analysis",{...context,analysis:"holdings"}),beta:true},
    {label:"현재 보유 연구",href:betaHref("/beta/simulation",{...context,run:undefined}),beta:true},
  ] : workspace === "history" || workspace === "ledger" ? [
    ...(context.mode === "domain" && existingCrudAvailable ? [{label:"거래·현금 기록",href:remainingWorkspaceHref("ledger",context),beta:true}] : []),
    { label: "히스토리", href: betaHref("/beta/history", context), beta: true },
    context.mode === "domain" ? { label: "날짜별 이벤트", href: eventHref(context, undefined), beta: true } : { label: "거래 내역", href: originalHref("/portfolio/events", context) },
    { label: "저장된 평가", href: context.mode === "domain" ? snapshotHref(context, undefined) : originalHref("/portfolio/portfolio-snapshots", context), beta: context.mode === "domain" },
  ] : [
    context.mode === "domain" ? { label: "저장 보유 근거", href: holdingsHref(context), beta: true } : { label: "보유 현황", href: originalHref("/portfolio/holdings", context) },
    { label: "포트 구조", href: betaHref("/beta/portfolio/structure", context), beta: true },
    context.mode === "domain" ? { label: "계좌 현황", href: accountsHref(context), beta: true } : { label: "계좌", href: originalHref("/portfolio/accounts", context) },
    ...(context.mode === "domain" && existingCrudAvailable ? [{ label: "계좌 관리", href: managementHref(context), beta: true }] : []),
    ...(context.mode === "domain" && existingCrudAvailable ? [{ label: "보유 관리", href: ownedManagementHref("holdings", context), beta: true }, { label: "범위 관리", href: ownedManagementHref("groups", context), beta: true }] : [context.mode === "domain" ? { label: "범위 관리 · 미연결", note: "기존 조회 범위의 선택만 지원하며 범위 생성·편집은 연결하지 않았습니다" } : { label: "분석 범위", href: originalHref("/portfolio/groups", context) }]),
  ];
  if(context.mode==='domain'&&existingCrudAvailable&&workspace&&['structure','holdings','accounts','groups','targets'].includes(workspace))subnav.push({label:'목표비중 관리',href:targetEditorHref(context),beta:true},{label:'거래·현금 기록',href:remainingWorkspaceHref('ledger',context),beta:true},{label:'저장된 투자계획',href:remainingWorkspaceHref('plans',context),beta:true});
  const readUnavailable = retryReadNeeded(readView);
  const canSwitchFrontend = existingCrudAvailable && frontendFeature && supportsExactFrontendChoice(pathname);
  const currentLink = (href: string) => isCurrentWorkspaceLink(pathname, context.analysis, href) ? 'page' as const : undefined;
  return <div ref={rootRef} className={`${styles.scope} ${tokens.scope} ${styles.shell} ${workspace ? styles.workspaceShell : styles.homeShell}`} data-reduced={reduceEffects} data-read-mode={context.mode ?? "demo"} data-beta-root>
    <aside className={styles.navigation} aria-label="목적별 내비게이션">
      <Link prefetch={context.mode === "domain" ? false : undefined} className={styles.brand} href={readHref(betaHref("/beta", context))}>CAIRN<span>LABS</span></Link>
      <nav>{purposeDestinations.map((item) => <div key={item.label}>
        {"beta" in item && (item.label !== "분석" || context.mode === "domain") && (item.label !== "계획" || context.mode === "domain") ? <Link prefetch={context.mode === "domain" ? false : undefined} className={styles.purposeLink} aria-current={((workspace === "plans" && item.label === "계획") || (!workspace && item.label === "홈") || ((workspace === "history" || workspace === "ledger") && item.label === "기록") || ((workspace === "structure" || workspace === "holdings" || workspace === "accounts" || workspace === "groups" || workspace === "targets") && item.label === "자산") || ((workspace === "analysis" || workspace === "simulation" || workspace === "etfs" || workspace === "lab") && item.label === "분석")) ? "page" : undefined} href={readHref(item.label === "계획" && existingCrudAvailable ? remainingWorkspaceHref("plans",context) : betaHref(item.beta, context) + ("hash" in item ? item.hash : ""))} title={item.label === "계획" ? "홈의 추가 투자 카드 · 확대해서 계산" : undefined}>
          <span className={styles.navIcon}><img src={`/cairn-v2/figma/${item.icon}`} alt="" /></span><span>{item.label}</span>
        </Link> : <a className={styles.purposeLink} href={originalHref(item.original, context)} title="기존 화면에서 계속"><span className={styles.navIcon}><img src={`/cairn-v2/figma/${item.icon}`} alt="" /></span><span>{item.label}</span>{workspace && <small>기존 ↗</small>}</a>}
        {workspace && ((workspace === "plans" && item.label === "계획") || ((workspace === "history" || workspace === "ledger") && item.label === "기록") || ((workspace === "structure" || workspace === "holdings" || workspace === "accounts" || workspace === "groups" || workspace === "targets") && item.label === "자산") || ((workspace === "analysis" || workspace === "simulation" || workspace === "etfs" || workspace === "lab") && item.label === "분석")) && <div className={`${styles.subnav} ${controls.subnav}`}>{subnav.map((sub) => sub.beta ? <Link prefetch={context.mode === "domain" ? false : undefined} href={readHref(sub.href)} aria-current={currentLink(sub.href)} key={sub.label}>{sub.label}</Link> : "note" in sub ? <span key={sub.label} title={sub.note}>{sub.label}</span> : <a key={sub.label} href={sub.href}>{sub.label}<small>기존 ↗</small></a>)}</div>}
      </div>)}</nav>
      <CairnButton variant="bare" className={`${styles.settingsLink} ${controls.settingsTrigger}`} type="button" aria-label="화면 설정" aria-haspopup="dialog" aria-expanded={!!settingsOrigin} onClick={e=>openSettings(e.currentTarget)}><span className={styles.navIcon}><img src="/cairn-v2/figma/75-319-0ad84.svg" alt="" /></span><span>설정</span></CairnButton>
    </aside>
    <main className={styles.main}>
      <header className={`${styles.topbar} ${workspace ? controls.workspaceTopbar : ""}`}>
        <CairnPageTitle>{presentation?.title ?? (workspace ? workspace === "history" ? "기록 / 히스토리" : workspace === "ledger" ? "기록 / 거래·현금" : workspace === "plans" ? "계획 / 저장된 투자계획" : workspace === "targets" ? "자산 / 목표비중" : workspace === "groups" ? "자산 / 범위 관리" : workspace === "accounts" ? "자산 / 계좌 현황" : workspace === "holdings" ? "자산 / 저장 보유 근거" : workspace === "lab" ? "분석 / 과거 비교" : workspace === "etfs" ? "분석 / ETF 구성" : workspace === "simulation" ? "분석 / 현재 보유 연구" : workspace === "analysis" ? "분석 / " + (context.analysis === "holdings" ? "집중·통화" : "위험·분산") : "자산 / 포트 구조" : "대시보드")}</CairnPageTitle>
        <CairnButton variant="bare" className={styles.scopeTrigger} type="button" aria-haspopup="dialog" aria-expanded={!!scopeOrigin} onClick={(e) => { setSearch(""); setScopeOrigin({ rect: e.currentTarget.getBoundingClientRect(), trigger: e.currentTarget }); }}>{selectedScope.label}<span aria-hidden>⌄</span></CairnButton>
        <div className={styles.topbarActions}>
          {!workspace && context.mode === 'domain' && existingCrudAvailable && <PortfolioRefreshButton autoSync compact />}
          {!workspace && readUnavailable && <CairnButton variant="bare" className={styles.retryRead} type="button" onClick={() => router.refresh()}>조회 다시 시도</CairnButton>}
        <CairnField className={styles.currency}><span className={styles.visuallyHidden}>표시 통화</span><CairnSelect aria-label="표시 통화" value={context.currency} onChange={(e) => setContext({ ...context, currency: e.target.value === "USD" ? "USD" : "KRW" })}><option>KRW</option><option>USD</option></CairnSelect></CairnField>
        <CairnButton variant="bare" className={controls.mobileSettingsTrigger} type="button" aria-label="화면 설정" aria-haspopup="dialog" aria-expanded={!!settingsOrigin} onClick={e=>openSettings(e.currentTarget)}><img src="/cairn-v2/figma/75-319-0ad84.svg" alt="" /></CairnButton>
        </div>
      </header>
      {!workspace && readView?.domain && <CairnStatus as="p" role="status" data-read-state={readView.domain.state} className={styles.readStatus}>{homeReadMessage(readView)}</CairnStatus>}
      {workspace && readUnavailable && <CairnButton variant="bare" className={styles.continueLink} type="button" onClick={() => router.refresh()}>조회 다시 시도</CairnButton>}
      {readView?.domain?.state === "unauthorized" && <a className={styles.continueLink} href={readHref(betaHref(workspace === "history" ? "/beta/history" : workspace === "structure" ? "/beta/portfolio/structure" : "/beta", { ...context, scope: "all" }))}>기본 범위 접근 다시 확인</a>}
      {context.mode === "domain" && workspace && <details className={controls.mobileMenu}>
        <summary>{presentation?.menuLabel ?? '작업 메뉴'}<span aria-hidden>⌄</span></summary>
        <nav aria-label={presentation?.menuLabel ?? '작업 메뉴'}>{subnav.map(sub => sub.beta && sub.href ? <Link key={sub.label} prefetch={false} href={readHref(sub.href)} aria-current={currentLink(sub.href)} onClick={e=>{const menu=e.currentTarget.closest('details');menu?.removeAttribute('open');menu?.querySelector('summary')?.focus({preventScroll:true});}}>{sub.label}</Link> : 'note' in sub ? <span key={sub.label}>{sub.label}</span> : null)}</nav>
      </details>}
      {children}
      <div className={`${styles.homeUtilities} ${existingCrudAvailable && workspace ? styles.crudUtilities : ""}`}>
      <footer className={styles.homeFooter}><span>{context.mode === "domain" ? existingCrudAvailable ? "기존 서비스의 데이터·관리 기능과 연결" : "읽기 전용 · 관리·저장 화면 미연결" : fixtureNotice}</span>{context.mode !== "domain" && <a href={originalHref(originalPath, context)}>기존 화면으로 ↗</a>}</footer>
      {context.mode === "domain" && <details className={styles.developmentTools}><summary id="beta-read-support">지원 범위 안내</summary><p>{existingCrudAvailable ? "계좌·보유·범위·목표·거래·계획 관리는 기존 처리 경로를 사용합니다. 각 작업에서 로그인·소유권과 지원 조건을 확인합니다. 원장 기록은 증권사 주문이 아닙니다. 보유 기반 추가 투자 계획의 새 계산·저장과 기타 온보딩은 별도입니다. 시세 수집은 관리 기능과 별도 설정을 따릅니다." : "이 환경에서는 연결된 읽기 화면을 사용할 수 있습니다. 관리·저장 화면은 제공하지 않습니다. 기존 관리 화면으로 이동하지 않습니다."}</p></details>}
      {context.mode !== "domain" && <details className={styles.developmentTools} aria-label="개발용 검증 설정"><summary>개발 검증 설정</summary><div className={styles.developmentSettings}>
        <CairnField>Fixture <CairnSelect aria-label="개발용 fixture 상태" value={context.fixture} onChange={(e) => setContext({ ...context, fixture: e.target.value as BetaContext["fixture"] })}><option value="standard">기본</option><option value="empty">빈 상태</option><option value="partial">부분 데이터</option><option value="large">큰 금액 · 긴 이름</option></CairnSelect></CairnField>
        {context.scope !== "all" && <span>가상 범위는 기존 화면에 전달되지 않습니다.</span>}
      </div></details>}
      </div>
    </main>
    {settingsOrigin && <BetaDialog popover label="화면 설정" origin={settingsOrigin} onClosed={()=>setPopover(null)}>
      <div className={controls.settingsContent}>
        <CairnSectionTitle level="h2">화면 설정</CairnSectionTitle>
        <CairnField className={controls.effectSetting}><CairnCheckbox checked={reduceEffects} onChange={e=>setReduceEffects(e.target.checked)} /><span>모션·투명 효과 줄이기<small>기기의 효과 감소 설정도 함께 적용합니다.</small></span></CairnField>
        <section aria-label="화면 버전"><CairnSectionTitle level="h3">기존 화면과 새 화면</CairnSectionTitle>
          {canSwitchFrontend ? <FrontendChoice enabled feature={frontendFeature} current="beta" context={{...context,_betaRead:freshness?.store.pendingEpoch() ?? undefined}} admittedScopeKeys={scopes.map(scope=>scope.key)}/> : <p>{context.mode === 'domain' && !supportsExactFrontendChoice(pathname) ? '이 화면의 날짜·범위를 유지하는 기존 화면 전환은 지원하지 않습니다.' : '이 환경에서는 기존 화면으로 전환하지 않습니다.'}</p>}
        </section>
        <p className={controls.settingsNote}>화면 설정은 입력값·선택·금융 데이터를 변경하지 않습니다.</p>
      </div>
    </BetaDialog>}
    {scopeOrigin && <BetaDialog popover label="조회 범위" origin={scopeOrigin} onClosed={() => setScopeOrigin(null)}>
      <div className={styles.scopeContent}><CairnSectionTitle level="h2">조회 범위</CairnSectionTitle><CairnField><span className={styles.visuallyHidden}>계좌 또는 범위 찾기</span><CairnInput type="search" placeholder="계좌 또는 범위 찾기" value={search} onChange={(e) => setSearch(e.target.value)} /></CairnField>
        <div className={styles.scopeOptions} role="group" aria-label={context.mode === "domain" ? "소유 조회 범위" : "가상 조회 범위"}>{scopes.filter((s) => `${s.label} ${s.detail}`.toLowerCase().includes(search.toLowerCase())).map((s) => <CairnButton variant="selection" type="button" key={s.key} aria-pressed={s.key === context.scope} onClick={() => { setContext({ ...context, scope: s.key }); setScopeOrigin(null); }}><span>{s.label}<small>{s.detail}</small></span><span aria-hidden>{s.key === context.scope ? "✓" : ""}</span></CairnButton>)}{scopes.filter((s) => `${s.label} ${s.detail}`.toLowerCase().includes(search.toLowerCase())).length === 0 && <p className={styles.empty}>일치하는 범위 없음</p>}</div>
        {context.mode === "domain" ? existingCrudAvailable ? <Link prefetch={false} className={styles.scopeManage} href={readHref(ownedManagementHref("groups",context))} onClick={()=>setScopeOrigin(null)}>분석 범위 관리 ↗</Link> : <p className={styles.scopeManage}>기존 조회 범위 선택만 지원 · 계좌·범위 생성/편집 미연결</p> : <a className={styles.scopeManage} href={originalHref("/portfolio/groups", context)}>분석 범위 관리 · 기존 화면에서 계속 ↗</a>}
      </div>
    </BetaDialog>}
  </div>;
}
