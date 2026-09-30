import { PortfolioText } from "@/components/portfolio/portfolio-text";
import Link from "next/link";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type {
  PortfolioRiskSelection,
  PortfolioRiskWindow,
} from "@/lib/portfolio-risk-read-model-types";
import { buildPortfolioRiskHref } from "@/lib/portfolio-risk-route";
import styles from "./risk-workspace.module.css";

const WINDOWS: PortfolioRiskWindow[] = [30, 90, 252];

export function PortfolioRiskControls({
  scopes,
  selectedScope,
  selection,
  isDesignPreview = false,
}: {
  scopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
  selection: PortfolioRiskSelection;
  isDesignPreview?: boolean;
}) {
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-semibold text-[var(--muted)]"><PortfolioText ko={"분석 범위"} /></p>
        <PortfolioAnalysisScopeTabs
          basePath="/portfolio/risk"
          query={{
            ...(isDesignPreview ? { preview: "design" } : {}),
            window:
              selection.window === 90 ? null : String(selection.window),
          }}
          scopes={scopes}
          selectedScopeKey={selectedScope.key}
        />
      </div>
      <RiskOptionGroup label="기간">
        {(isDesignPreview ? [selection.window] : WINDOWS).map((window) => (
          <RiskOptionLink
            key={window}
            href={`${buildPortfolioRiskHref(selectedScope.key, window)}${isDesignPreview ? "&preview=design" : ""}`}
            active={selection.window === window}
          >
            {window}<PortfolioText ko={"일"} />{isDesignPreview ? <> <PortfolioText ko="예시" /></> : null}
          </RiskOptionLink>
        ))}
      </RiskOptionGroup>
    </div>
  );
}

function RiskOptionGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-[var(--muted)]"><PortfolioText ko={label} /></p>
      <div className={styles.periodOptions}>
        {children}
      </div>
    </div>
  );
}

function RiskOptionLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={styles.periodOption}
    >
      {children}
    </Link>
  );
}
