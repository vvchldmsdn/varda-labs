import { TradeRecordLinks } from "@/components/trade-record-links";
import { isActivityAdmin } from "@/lib/auth/member-activity-identity";
import { getLocale, localizedMetadata } from "@/lib/i18n/server";
import { T } from "@/components/i18n/localized-text";
import { PortfolioText } from "@/components/portfolio/portfolio-text";
import { portfolioEnglish } from "@/components/portfolio/portfolio-copy";
import Link from "next/link";
import { ArrowRight, CircleHelp, Database, FolderOpen, Landmark, Layers3, ListChecks, Plus, RefreshCw, SlidersHorizontal, Wallet } from "lucide-react";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import { ActionGroup, ActionContent, PageTitle as CairnPageTitle } from "@/components/cairn-ui";
import styles from "@/components/portfolio/management-hub.module.css";


export async function generateMetadata() {
  return localizedMetadata({ title: "관리 | CAIRN LABS" }, "Manage | CAIRN LABS");
}

const groups = [
  { title: "자산과 계좌", links: [
    { href: "/portfolio/accounts", title: "계좌", description: "증권·연금 계좌를 추가하고 관리합니다.", icon: Landmark },
    { href: "/portfolio/holdings", title: "보유 종목", description: "보유 수량, 매입원가와 자산 정보를 확인합니다.", icon: Wallet },
    { href: "/portfolio/groups", title: "분석 범위", description: "여러 계좌와 종목을 목적에 맞게 묶습니다.", icon: Layers3 },
  ] },
  { title: "목표와 기준", links: [
    { href: "/portfolio/targets", title: "목표비중", description: "추가 투입과 포트폴리오 관리의 기준을 정합니다.", icon: SlidersHorizontal },
    { href: "/portfolio/holdings/new", title: "보유 종목 추가", description: "주식, ETF, 금현물과 금융자산을 등록합니다.", icon: Plus },
    { href: "/etfs", title: "ETF 정보", description: "ETF의 분류와 참고 정보를 확인합니다.", icon: FolderOpen },
  ] },
  { title: "기록", links: [
    { href: "/portfolio/ledger", title: "매매·현금 기록", description: "체결한 매매와 입출금을 기록합니다.", icon: ListChecks },
    { href: "/portfolio/events?account=all", title: "거래와 이벤트", description: "매매·입출금 등 자산의 변화를 확인합니다.", icon: ListChecks },
    { href: "/portfolio/portfolio-snapshots?account=all", title: "포트폴리오 스냅샷", description: "날짜별로 저장된 평가액과 수익률입니다.", icon: Database },
    { href: "/portfolio/position-snapshots?account=all", title: "종목별 스냅샷", description: "보유 종목의 날짜별 평가 근거입니다.", icon: FolderOpen },
  ] },
  { title: "시장 데이터", links: [
    { href: "/admin/market-sync", title: "시장 데이터 동기화", description: "가격·환율 데이터의 갱신 상태를 확인합니다.", icon: RefreshCw },
    { href: "/market", title: "시장 현황", description: "연결된 시장 지표와 기준일을 확인합니다.", icon: Landmark },
  ] },
] as const;

export default async function PortfolioManagementPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const targetQuery = new URLSearchParams({ from: "manage" });
  // Forward scope unchanged so the target page can validate ownership and reject ambiguous input.
  for (const key of ["scope", "account"] as const) {
    const value = params[key];
    for (const item of typeof value === "string" ? [value] : value ?? []) targetQuery.append(key, item);
  }
  if (process.env.NODE_ENV === "development" && params.preview === "design") targetQuery.set("preview", "design");
  const targetHref = `/portfolio/targets?${targetQuery}`;
  const [activityAdmin, locale] = await Promise.all([isActivityAdmin(), getLocale()]);
  return <main className="varda-page varda-stage-page" data-surface="manage">
    <SecondaryPageHeader />
    <div className="varda-content varda-stage-content">
      <div className={styles.workspace}>
        <header className={styles.header}>
          <CairnPageTitle><T ko="관리" en="Manage" /></CairnPageTitle>
          <TradeRecordLinks variant="topbar" />
        </header>
        <ActionGroup label={locale === "en" ? "Add assets" : "자산 등록"} className={styles.primary}>
          <Link href="/portfolio/holdings/new" data-primary="true"><ActionContent icon={<Plus />} title={<T ko="보유 종목 추가" en="Add holdings" />} description={<T ko="종목과 수량으로 시작해요" en="Start with a holding and quantity" />} /></Link>
          <Link href={targetHref}><ActionContent icon={<SlidersHorizontal />} title={<T ko="목표비중 설정" en="Set target weights" />} description={<T ko="내 포트의 기준을 정해요" en="Set your portfolio's allocation" />} /></Link>
        </ActionGroup>
        <div className={styles.sections}>
          {groups.map(group => <section className={styles.section} key={group.title}>
            <h2><PortfolioText ko={group.title} /></h2>
            <ActionGroup label={locale === "en" ? portfolioEnglish(group.title) : group.title} layout="list">{group.links.filter(link => link.href !== "/portfolio/targets" && link.href !== "/portfolio/holdings/new").map(({ href, title, icon: Icon }) => <Link href={href} key={href}><ActionContent icon={<Icon />} title={<PortfolioText ko={title} en={href === "/portfolio/ledger" ? "Trade & cash records" : undefined} />} /></Link>)}</ActionGroup>
          </section>)}
        </div>
        {activityAdmin ? <Link className="mt-5 inline-flex min-h-11 items-center text-sm underline" href="/management/members">회원 활동 관리 →</Link> : null}
        <footer className={styles.help}><PresentationDialog label={<><CircleHelp size={18} aria-hidden="true" /><PortfolioText ko={"처음 시작하기"} /></>} title="포트폴리오를 만드는 순서" titleEn={portfolioEnglish("포트폴리오를 만드는 순서")}><ol className="varda-management-guide"><li><strong><PortfolioText ko={"01 · 계좌 등록"} /></strong><p><PortfolioText ko={"증권·연금 계좌를 만들고 분석할 자산을 정리하세요."} /></p><Link href="/portfolio/accounts"><PortfolioText ko={"계좌 관리"} />{" "}<ArrowRight size={14} /></Link></li><li><strong><PortfolioText ko={"02 · 보유 종목 등록"} /></strong><p><T ko="종목 이름과 수량으로 시작하세요. 매입가는 나중에 입력해도 됩니다." en="Start with a holding name and quantity. You can add purchase costs later." /></p><Link href="/portfolio/holdings/new"><PortfolioText ko={"종목 추가"} />{" "}<ArrowRight size={14} /></Link></li><li><strong><PortfolioText ko={"03 · 목표비중 설정"} /></strong><p><PortfolioText ko={"금현물을 포함해 관리하려는 종목의 목표비중을 정하세요."} /></p><Link href={targetHref}><PortfolioText ko={"목표비중 관리"} />{" "}<ArrowRight size={14} /></Link></li></ol></PresentationDialog></footer>
      </div>
    </div>
  </main>;
}
