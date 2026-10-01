import { ManagementElement, ManagementText } from "@/components/i18n/management-text";
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
    <ManagementElement as="nav"
      aria-label="계좌 범위"
      className="cairn-tabs w-fit max-w-full overflow-x-auto"
    >
      {ACCOUNT_TABS.map((tab) => {
        const selected = tab.account === selectedAccount;
        return (
          <Link
            key={tab.account}
            aria-current={selected ? "page" : undefined}
            className="min-w-14 text-center font-medium whitespace-nowrap"
            href={buildPortfolioAccountScopeHref(
              basePath,
              tab.account,
              query,
            )}
          >
            <ManagementText>{tab.label}</ManagementText>
          </Link>
        );
      })}
    </ManagementElement>
  );
}

export function portfolioAccountScopeLabel(account: PortfolioAccountScope) {
  return ACCOUNT_TABS.find((tab) => tab.account === account)?.label ?? account;
}
