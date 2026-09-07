import Link from "next/link";
import { ArrowRight, CircleHelp, Database, FolderOpen, Landmark, Layers3, ListChecks, Plus, RefreshCw, SlidersHorizontal, Wallet } from "lucide-react";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";

export const metadata = { title: "관리 | VARDA LABS" };

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
    { href: "/portfolio/events?account=all", title: "거래와 이벤트", description: "매매·입출금 등 자산의 변화를 확인합니다.", icon: ListChecks },
    { href: "/portfolio/portfolio-snapshots?account=all", title: "포트폴리오 스냅샷", description: "날짜별로 저장된 평가액과 수익률입니다.", icon: Database },
    { href: "/portfolio/position-snapshots?account=all", title: "종목별 스냅샷", description: "보유 종목의 날짜별 평가 근거입니다.", icon: FolderOpen },
  ] },
  { title: "시장 데이터", links: [
    { href: "/admin/market-sync", title: "시장 데이터 동기화", description: "가격·환율 데이터의 갱신 상태를 확인합니다.", icon: RefreshCw },
    { href: "/market", title: "시장 현황", description: "연결된 시장 지표와 기준일을 확인합니다.", icon: Landmark },
  ] },
] as const;

export default function PortfolioManagementPage() {
  return <main className="varda-page varda-stage-page">
    <SecondaryPageHeader />
    <div className="varda-content varda-stage-content">
      <div className="varda-management-stage">
        <header className="varda-management-cover">
          <p className="varda-kicker">YOUR WORKSPACE</p>
          <h1>나의 자산, <br />나의 기준.</h1>
          <p className="varda-management-cover-note">포트폴리오를 이루는 데이터와 <br />분석의 기준을 관리하세요.</p>
          <Link href="/portfolio/holdings/new" className="varda-action"><Plus size={16} aria-hidden="true" />보유 종목 추가</Link>
        </header>
        <div className="varda-management-index" aria-label="관리할 데이터 선택">
          {groups.map((group, index) => <PresentationDialog key={group.title} title={group.title} triggerClassName="varda-management-chapter" label={<><span className="varda-management-chapter-number">0{index + 1}</span><span className="varda-management-chapter-title"><strong>{group.title}</strong><small>{group.links.map(link => link.title).join(" · ")}</small></span></>}>
            <div>{group.links.map(({ href, title, description, icon: Icon }) => <Link href={href} className="varda-management-link" key={href}><Icon size={19} strokeWidth={1.6} aria-hidden="true" /><span>{title}<small>{description}</small></span><ArrowRight size={16} aria-hidden="true" /></Link>)}</div>
          </PresentationDialog>)}
        </div>
        <footer className="varda-management-stage-footer"><span>정리된 데이터에서 시작하는 분석</span><PresentationDialog label={<><CircleHelp size={14} aria-hidden="true" />처음 시작하기</>} title="포트폴리오를 만드는 순서"><ol className="varda-management-guide"><li><strong>01 · 계좌 등록</strong><p>증권·연금 계좌를 만들고 분석할 자산을 정리하세요.</p><Link href="/portfolio/accounts">계좌 관리 <ArrowRight size={14} /></Link></li><li><strong>02 · 보유 종목 등록</strong><p>수량과 매입원가를 입력하면 자산 평가와 손익의 근거가 됩니다.</p><Link href="/portfolio/holdings/new">종목 추가 <ArrowRight size={14} /></Link></li><li><strong>03 · 목표비중 설정</strong><p>금현물을 포함해 관리하려는 종목의 목표비중을 정하세요.</p><Link href="/portfolio/targets">목표비중 관리 <ArrowRight size={14} /></Link></li></ol></PresentationDialog></footer>
      </div>
    </div>
  </main>;
}
