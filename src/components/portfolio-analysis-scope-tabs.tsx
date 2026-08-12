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
}: {
  basePath: string;
  query?: PortfolioAnalysisScopeQuery;
  scopes: readonly PortfolioAnalysisScope[];
  selectedScopeKey: PortfolioAnalysisScopeKey | null;
}) {
  return (
    <nav
      aria-label="자산 분석 범위"
      className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-[#d8ddd2] bg-white p-1"
    >
      {scopes.map((scope) => {
        const selected = scope.key === selectedScopeKey;
        return (
          <Link
            key={scope.key}
            aria-current={selected ? "page" : undefined}
            aria-label={`${scope.label} ${scopeKindLabel(scope)}`}
            className={`min-w-16 rounded px-3 py-2 text-center text-sm font-semibold whitespace-nowrap ${
              selected
                ? "bg-[#173f38] text-white"
                : "text-[#48524a] hover:bg-[#edf1eb]"
            }`}
            href={buildPortfolioAnalysisScopeHref(basePath, scope.key, query)}
          >
            {scope.label}
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
