"use client";

import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { ArrowUpRight, ChartNoAxesCombined, ChartPie, ChevronLeft, ChevronRight, FlaskConical, History, House, Menu, Plus, Settings2, TrendingUp, UserRound, X } from "lucide-react";
import { PortfolioRefreshButton } from "@/components/home/portfolio-refresh-button";
import { formatKstTime } from "@/components/home/portfolio-format";
import { buildPortfolioAnalysisScopeHref, type PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";

const navigation = [
  { title: "포트폴리오", items: [
    { href: "/", label: "홈", icon: House },
    { href: "/today", label: "오늘 변동", icon: ChartNoAxesCombined },
    { href: "/history", label: "히스토리", icon: History },
    { href: "/portfolio/structure", label: "포트 구조", icon: ChartPie },
  ] },
  { title: "계획과 탐색", items: [
    { href: "/additional-contribution", label: "추가 투입", icon: Plus },
    { href: "/investment-lab", label: "투자 랩", icon: FlaskConical },
    { href: "/simulation", label: "시뮬레이션", icon: TrendingUp },
  ] },
  { title: "나의 데이터", items: [
    { href: "/portfolio/manage", label: "관리", icon: Settings2 },
  ] },
] as const;

const mobileNavigation = [
  navigation[0].items[1], navigation[1].items[0], navigation[0].items[0],
  navigation[0].items[3], navigation[0].items[2],
];

function PendingHint() {
  const { pending } = useLinkStatus();
  return <span className="varda-link-pending" data-pending={pending || undefined} aria-hidden="true" />;
}

export function AppNavigation({ activePath, generatedAt, selectedScopeKey }: {
  activePath?: string;
  generatedAt?: string;
  selectedScopeKey?: PortfolioAnalysisScopeKey;
}) {
  const {t, locale} = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const menuRef = useRef<HTMLDialogElement>(null);
  const preview = process.env.NODE_ENV === "development" && params.get("preview") === "design";
  const scope = selectedScopeKey ?? params.get("scope");
  const currentPath = activePath ?? pathname;

  function hrefFor(path: string) {
    const [pathBase, pathQuery = ""] = path.split("?");
    const scoped = selectedScopeKey
      ? buildPortfolioAnalysisScopeHref(pathBase, selectedScopeKey, Object.fromEntries(new URLSearchParams(pathQuery)))
      : path;
    const [base, query = ""] = scoped.split("?");
    const next = new URLSearchParams(query);
    if (!selectedScopeKey && scope) next.set("scope", scope);
    if (preview) next.set("preview", "design");
    return `${base}${next.size ? `?${next}` : ""}`;
  }

  function isActive(href: string) {
    if (href === currentPath) return true;
    if (href === "/portfolio/structure" && currentPath === "/portfolio/risk") return true;
    return href === "/portfolio/manage" && (
      currentPath.startsWith("/admin/") ||
      currentPath === "/market" || currentPath === "/etfs" ||
      (currentPath.startsWith("/portfolio/") && !["/portfolio/structure", "/portfolio/risk"].includes(currentPath))
    );
  }

  const allItems = navigation.flatMap((group) => [...group.items]);
  const currentIndex = allItems.findIndex((item) => isActive(item.href));
  const currentItem = allItems[currentIndex];
  const previousItem = currentIndex > 0 ? allItems[currentIndex - 1] : null;
  const nextItem = currentIndex >= 0 ? allItems[currentIndex + 1] : null;
  const links = (
    <nav className="varda-sidebar-groups" aria-label={t("주요 메뉴", "Main navigation")}>
      {navigation.map((group) => (
        <div className="varda-sidebar-group" key={group.title}>
          <p>{t(group.title, group.title === "계획과 탐색" ? "Plan & explore" : group.title === "나의 데이터" ? "My data" : "Portfolio")}</p>
          {group.items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={hrefFor(href)} aria-current={isActive(href) ? "page" : undefined}
              className="varda-sidebar-link" onClick={() => menuRef.current?.close()}>
              <Icon size={21} strokeWidth={1.6} aria-hidden="true" />
              <span>{t(label)}</span><PendingHint />
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <header className="varda-app-navigation">
      <a className="varda-skip-link" href="#varda-main-content">{t("본문으로 건너뛰기", "Skip to content")}</a>
      <aside className="varda-sidebar" aria-label={t("서비스 탐색", "App navigation")}>
        <Link className="varda-sidebar-brand" href={hrefFor("/")} aria-label={t("VARDA LABS 홈", "VARDA LABS home")}>
          <Image src="/varda-mark.png" alt="" width={29} height={29} />
          <span>VARDA</span>
        </Link>
        {links}
        <div className="varda-sidebar-bottom">
          {preview ? <span className="varda-preview-label" title={t("디자인 미리보기 · 예시 데이터", "Design preview · Demo data")}><i />{t("예시")}</span> : null}
          <Link href={hrefFor("/auth/session?view=account")} className="varda-sidebar-account">
            <UserRound size={20} strokeWidth={1.6} aria-hidden="true" /><span>{t("내 계정")}</span>
          </Link>
        </div>
      </aside>
      <div className="varda-topbar">
        <div className="varda-topbar-location">
          <span className="varda-mobile-brand">VARDA</span>
          <span className="varda-breadcrumb">PORTFOLIO</span><span className="varda-breadcrumb-slash">/</span>
          <strong>{t(currentItem?.label ?? "관리")}</strong>
        </div>
        <div className="varda-topbar-actions">
          <nav className="varda-scene-pager" aria-label={t("화면 순서 이동", "Previous and next page")}>
            {previousItem ? <Link href={hrefFor(previousItem.href)} aria-label={t(`이전 화면: ${previousItem.label}`, `Previous page: ${t(previousItem.label)}`)} title={t(previousItem.label)}><ChevronLeft size={16} aria-hidden="true" /></Link> : <span aria-hidden="true" />}
            <span className="varda-scene-number">{String(Math.max(0, currentIndex) + 1).padStart(2, "0")}<i>/</i>{String(allItems.length).padStart(2, "0")}</span>
            {nextItem ? <Link href={hrefFor(nextItem.href)} aria-label={t(`다음 화면: ${nextItem.label}`, `Next page: ${t(nextItem.label)}`)} title={t(nextItem.label)}><ChevronRight size={16} aria-hidden="true" /></Link> : <span aria-hidden="true" />}
          </nav>
          {preview ? <span className="varda-topbar-preview"><i />{t("예시 데이터")}</span>
            : generatedAt ? <span className="varda-updated-at">{locale === "en" ? `View refreshed ${new Intl.DateTimeFormat("en-GB", {hour:"2-digit",minute:"2-digit", timeZone:"Asia/Seoul"}).format(new Date(generatedAt))} KST` : `화면 갱신 ${formatKstTime(generatedAt)}`}</span> : null}
          {!preview && generatedAt ? <PortfolioRefreshButton compact autoSync={currentPath === "/history" || currentPath === "/today"} /> : null}
          <LanguageSwitch />
          <Link className="varda-topbar-add" aria-label={t("종목 추가")} href={hrefFor("/portfolio/holdings/new")}>
            <Plus size={18} aria-hidden="true" /><span>{t("종목 추가")}</span>
          </Link>
          <button type="button" className="varda-mobile-menu-button" onClick={() => menuRef.current?.showModal()} aria-label={t("메뉴 열기", "Open menu")}>
            <Menu size={22} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>
      <nav className="varda-mobile-bottom" aria-label={t("빠른 메뉴", "Quick navigation")}>
        {mobileNavigation.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={hrefFor(href)} aria-current={isActive(href) ? "page" : undefined}>
            <Icon size={23} strokeWidth={1.6} aria-hidden="true" /><span>{t(label)}</span><PendingHint />
          </Link>
        ))}
      </nav>
      <dialog ref={menuRef} className="varda-mobile-menu" aria-label={t("전체 메뉴", "All navigation")}
        onClick={(event) => { if (event.target === event.currentTarget) menuRef.current?.close(); }}>
        <div className="varda-mobile-menu-inner">
          <div className="varda-mobile-menu-heading"><span className="varda-wordmark">VARDA LABS</span>
            <button type="button" className="varda-icon-button" onClick={() => menuRef.current?.close()} aria-label={t("메뉴 닫기", "Close menu")}><X size={22} /></button>
          </div>
          {links}
          <Link className="varda-menu-account" href={hrefFor("/auth/session?view=account")} onClick={() => menuRef.current?.close()}>
            <UserRound size={18} />{t("내 계정")}<ArrowUpRight size={15} />
          </Link>
        </div>
      </dialog>
      <span id="varda-main-content" tabIndex={-1} className="varda-content-anchor" />
    </header>
  );
}
