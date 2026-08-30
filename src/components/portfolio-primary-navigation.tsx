import Link from "next/link";
import Image from "next/image";
import { UserRound } from "lucide-react";

import { formatKstTime } from "@/components/home/portfolio-format";
import { PortfolioRefreshButton } from "@/components/home/portfolio-refresh-button";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";

const PRIMARY_NAV_ITEMS = [
  { label: "홈", href: "/" },
  { label: "오늘 변동", href: "/today" },
  { label: "추가 투입", href: "/additional-contribution" },
  { label: "포트 구조", href: "/portfolio/structure" },
  { label: "히스토리", href: "/history" },
  { label: "투자 랩", href: "/investment-lab" },
  { label: "시뮬레이션", href: "/simulation" },
] as const;

type PrimaryNavigationPath = (typeof PRIMARY_NAV_ITEMS)[number]["href"];

export function PortfolioPrimaryNavigation({
  activePath,
  generatedAt,
  selectedScopeKey,
}: {
  activePath: PrimaryNavigationPath;
  generatedAt: string;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  return (
    <header className="varda-navigation">
      <div className="varda-navigation-inner">
        <Link
          className="varda-wordmark"
          href={scopedHref("/", selectedScopeKey)}
        >
          <Image src="/varda-mark.png" width={24} height={24} alt="" />
          <span>VARDA-LABS</span>
        </Link>

        <nav aria-label="주요 메뉴" className="varda-main-menu">
          <div>
            {PRIMARY_NAV_ITEMS.map((item) => {
              const active = item.href === activePath;
              return (
                <Link
                  key={item.href}
                  aria-current={active ? "page" : undefined}
                  className="font-medium"
                  href={scopedHref(item.href, selectedScopeKey)}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="varda-navigation-actions">
          <span className="hidden text-xs text-[var(--muted)] md:inline">
            {formatKstTime(generatedAt)} 기준
          </span>
          <PortfolioRefreshButton compact />
          <Link
            aria-label="내 계정"
            title="내 계정"
            className="varda-icon-button"
            href="/auth/session?view=account"
          >
            <UserRound size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function scopedHref(
  path: string,
  selectedScopeKey: PortfolioAnalysisScopeKey,
) {
  return buildPortfolioAnalysisScopeHref(path, selectedScopeKey);
}
