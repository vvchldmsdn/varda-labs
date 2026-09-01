import Link from "next/link";
import { ScrollableNavRail } from "@/components/scrollable-nav-rail";

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
    <ScrollableNavRail
      ariaLabel="자산 분석 범위"
      viewportClassName={
        underline
          ? "max-w-full pb-1 text-sm"
          : "max-w-full rounded-md border border-[var(--line)] bg-white p-1"
      }
      contentClassName={
        underline
          ? "flex w-max min-w-full items-center gap-7 sm:gap-10"
          : "flex w-max min-w-full gap-1"
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
                ? `shrink-0 border-b py-2 font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--brand)] ${
                    selected
                      ? "border-[var(--ink)] text-[var(--ink)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                  }`
                : `min-w-16 rounded px-3 py-2 text-center text-sm font-semibold whitespace-nowrap ${
                    selected
                      ? "bg-[var(--ink)] text-white"
                      : "text-[var(--muted)] hover:bg-[var(--wash)]"
                  }`
            }
            href={buildPortfolioAnalysisScopeHref(basePath, scope.key, query)}
          >
            {underline && scope.kind === "all" ? "전체 자산" : scope.label}
          </Link>
        );
      })}
    </ScrollableNavRail>
  );
}

function scopeKindLabel(scope: PortfolioAnalysisScope) {
  if (scope.kind === "portfolio_group") return "분석 범위";
  if (scope.kind === "account") return "계좌";
  return "전체 자산";
}
