import Link from "next/link";

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
    <header className="border-b border-[#e1e4df] bg-[#fafbf8]">
      <div className="mx-auto flex min-h-16 w-full max-w-[1540px] items-center justify-between gap-5 px-5 sm:px-8 lg:px-10">
        <Link
          className="shrink-0 text-sm font-semibold text-[#171a16] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]"
          href={scopedHref("/", selectedScopeKey)}
        >
          VARDA
        </Link>

        <nav aria-label="주요 메뉴" className="min-w-0 overflow-x-auto">
          <div className="flex min-w-max items-center gap-6 text-sm lg:gap-9">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const active = item.href === activePath;
              return (
                <Link
                  key={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`border-b py-5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#347e62] ${
                    active
                      ? "border-[#20231f] text-[#20231f]"
                      : "border-transparent text-[#61675f] hover:text-[#20231f]"
                  }`}
                  href={scopedHref(item.href, selectedScopeKey)}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-[#6f756d] md:inline">
            {formatKstTime(generatedAt)} 기준
          </span>
          <PortfolioRefreshButton compact />
          <Link
            aria-label="세션 정보"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#d8dcd6] bg-[#f2f4f0] text-xs font-semibold hover:border-[#aeb4ac] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#347e62]"
            href="/auth/session"
          >
            V
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
