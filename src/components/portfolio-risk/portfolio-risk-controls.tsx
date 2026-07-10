import Link from "next/link";

import type {
  PortfolioRiskAccount,
  PortfolioRiskSelection,
  PortfolioRiskWindow,
} from "@/lib/portfolio-risk-read-model-types";
import { buildPortfolioRiskHref } from "@/lib/portfolio-risk-route";

import { accountLabel } from "./portfolio-risk-format";

const ACCOUNTS: PortfolioRiskAccount[] = [
  "brokerage",
  "isa",
  "irp",
  "all",
];
const WINDOWS: PortfolioRiskWindow[] = [30, 90, 252];

export function PortfolioRiskControls({
  selection,
}: {
  selection: PortfolioRiskSelection;
}) {
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <RiskOptionGroup label="계좌">
        {ACCOUNTS.map((account) => (
          <RiskOptionLink
            key={account}
            href={buildPortfolioRiskHref(account, selection.window)}
            active={selection.account === account}
          >
            {accountLabel(account)}
          </RiskOptionLink>
        ))}
      </RiskOptionGroup>
      <RiskOptionGroup label="기간">
        {WINDOWS.map((window) => (
          <RiskOptionLink
            key={window}
            href={buildPortfolioRiskHref(selection.account, window)}
            active={selection.window === window}
          >
            {window}일
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
      <p className="mb-1 text-xs font-semibold text-[#687064]">{label}</p>
      <div className="flex min-h-10 flex-wrap gap-1 rounded-md border border-[#d8ddcf] bg-white p-1">
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
      className={`min-w-16 rounded px-3 py-2 text-center text-sm font-semibold ${
        active
          ? "bg-[#1e3a34] text-white"
          : "text-[#526057] hover:bg-[#edf1e8]"
      }`}
    >
      {children}
    </Link>
  );
}
