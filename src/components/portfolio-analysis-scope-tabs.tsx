import Link from "next/link";

import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScope,
  type PortfolioAnalysisScopeKey,
  type PortfolioAnalysisScopeQuery,
} from "@/lib/portfolio-analysis-scope";

export function PortfolioAnalysisScopeTabs({
  basePath,
  query,
  scopes,
  selectedScopeKey,
  variant = "segmented",
}: {
  basePath: string;
  query?: PortfolioAnalysisScopeQuery;
  scopes: readonly PortfolioAnalysisScope[];
  selectedScopeKey: PortfolioAnalysisScopeKey | null;
  variant?: "segmented" | "underline";
}) {
  const underline = variant === "underline";

  return (
    <nav
      aria-label="자산 분석 범위"
      className={
        underline
          ? "flex max-w-full items-center gap-7 overflow-x-auto pb-1 text-sm sm:gap-10"
          : "flex max-w-full gap-1 overflow-x-auto rounded-md border border-[#d8ddd2] bg-white p-1"
      }
    >
      {scopes.map((scope) => {
        const selected = scope.key === selectedScopeKey;
        return (
          <Link
            key={scope.key}
            aria-current={selected ? "page" : undefined}
            aria-label={`${scope.label} ${scopeKindLabel(scope)}`}
            className={
              underline
                ? `shrink-0 border-b py-2 font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#347e62] ${
                    selected
                      ? "border-[#20231f] text-[#20231f]"
                      : "border-transparent text-[#666c64] hover:text-[#20231f]"
                  }`
                : `min-w-16 rounded px-3 py-2 text-center text-sm font-semibold whitespace-nowrap ${
                    selected
                      ? "bg-[#173f38] text-white"
                      : "text-[#48524a] hover:bg-[#edf1eb]"
                  }`
            }
            href={buildPortfolioAnalysisScopeHref(basePath, scope.key, query)}
          >
            {underline && scope.kind === "all" ? "전체 자산" : scope.label}
          </Link>
        );
      })}
    </nav>
  );
}

function scopeKindLabel(scope: PortfolioAnalysisScope) {
  if (scope.kind === "portfolio_group") return "자산 그룹";
  if (scope.kind === "account") return "계좌";
  return "전체 자산";
}
