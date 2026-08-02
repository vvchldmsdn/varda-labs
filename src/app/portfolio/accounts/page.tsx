import Link from "next/link";

import {
  AccountScopeTabs,
  portfolioAccountScopeLabel,
} from "@/components/account-scope-tabs";
import {
  getReadOnlyTenantAccounts,
  type TenantAccountQueryResult,
} from "@/db/queries/tenant-accounts";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { normalizePortfolioAccountScope } from "@/lib/portfolio-account-scope";
import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";

export const dynamic = "force-dynamic";

type AccountScopePageProps = {
  searchParams: Promise<{
    account?: string | string[];
  }>;
};

export default async function AccountScopePage({
  searchParams,
}: AccountScopePageProps) {
  const params = await searchParams;
  const scope = normalizePortfolioAccountScope(params.account);
  const resolution = await resolveCurrentTenantContext();
  const accounts = resolution.ok
    ? await getReadOnlyTenantAccounts({
        tenantContext: resolution.tenantContext,
        scope,
      })
    : null;

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#687064]">
              Varda Labs
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              Owner-scoped accounts
            </h1>
            <p className="mt-2 text-sm text-[#687064]">
              Server session and canonical ownership only
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/portfolio/holdings?account=all"
              className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
            >
              Holdings
            </Link>
            <Link
              href="/portfolio/position-snapshots?account=all"
              className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
            >
              Position snapshots
            </Link>
            <Link
              href="/portfolio/portfolio-snapshots?account=all"
              className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
            >
              Portfolio snapshots
            </Link>
            <Link
              href="/auth/session"
              className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
            >
              Session evidence
            </Link>
          </div>
        </div>

        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <EvidenceCell
            label="Portfolio user link"
            value={sessionResolutionEvidence(resolution)}
          />
          <EvidenceCell
            label="Product database read"
            value={productReadEvidence(accounts)}
          />
        </dl>

        {accounts?.state === "ready" ? (
          <section className="mt-6 border-t border-[#dfe3d5] pt-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#687064]">
                  Account scope
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {portfolioAccountScopeLabel(scope)}
                </h2>
              </div>
              <AccountScopeTabs
                basePath="/portfolio/accounts"
                selectedAccount={scope}
              />
            </div>

            <ul className="mt-4 divide-y divide-[#e5e8df] rounded-md border border-[#dfe3d5] bg-white">
              {accounts.accounts.length === 0 ? (
                <li className="p-4 text-sm text-[#687064]">
                  No owned account is assigned to this scope.
                </li>
              ) : (
                accounts.accounts.map((account) => (
                  <li
                    key={account.code}
                    className="flex items-center justify-between gap-4 p-4"
                  >
                    <div>
                      <p className="font-semibold">{account.name}</p>
                      <p className="text-xs text-[#687064]">
                        {account.code} / {account.accountType}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">
                      {account.currency}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        ) : (
          <p className="mt-6 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
            Account data remains closed until the reviewed identity and owner
            bootstrap is complete.
          </p>
        )}
      </section>
    </main>
  );
}

function productReadEvidence(result: TenantAccountQueryResult | null) {
  if (result === null) return "Not attempted";
  if (result.state === "unavailable") return "Unavailable";
  if (result.state === "integrity_error") return "Blocked";
  return `${result.accounts.length} account${
    result.accounts.length === 1 ? "" : "s"
  }`;
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#dfe3d5] bg-white p-4">
      <dt className="text-xs font-semibold text-[#687064]">{label}</dt>
      <dd className="mt-2 font-semibold">{value}</dd>
    </div>
  );
}
