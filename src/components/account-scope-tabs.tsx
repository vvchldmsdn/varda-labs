import Link from "next/link";

import {
  buildPortfolioAccountScopeHref,
  type PortfolioAccountScope,
  type PortfolioAccountScopeQuery,
} from "@/lib/portfolio-account-scope";

const ACCOUNT_TABS = Object.freeze([
  { account: "brokerage", label: "증권" },
  { account: "isa", label: "ISA" },
  { account: "irp", label: "IRP" },
  { account: "all", label: "전체" },
] as const);

export function AccountScopeTabs({
  basePath,
  query,
  selectedAccount,
}: {
  basePath: string;
  query?: PortfolioAccountScopeQuery;
  selectedAccount: PortfolioAccountScope;
}) {
  return (
    <nav
      aria-label="계좌 범위"
      className="flex w-fit max-w-full overflow-x-auto rounded-md border border-[#d8ddd2] bg-white p-1"
    >
      {ACCOUNT_TABS.map((tab) => {
        const selected = tab.account === selectedAccount;
        return (
          <Link
            key={tab.account}
            aria-current={selected ? "page" : undefined}
            className={`min-w-14 rounded px-3 py-2 text-center text-sm font-semibold whitespace-nowrap ${
              selected
                ? "bg-[#173f38] text-white"
                : "text-[#48524a] hover:bg-[#edf1eb]"
            }`}
            href={buildPortfolioAccountScopeHref(
              basePath,
              tab.account,
              query,
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function portfolioAccountScopeLabel(account: PortfolioAccountScope) {
  return ACCOUNT_TABS.find((tab) => tab.account === account)?.label ?? account;
}
