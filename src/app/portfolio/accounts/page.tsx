import Link from "next/link";

import {
  AccountCreateForm,
  AccountEditor,
  ArchivedAccountRow,
} from "@/components/account-management";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { getReadOnlyTenantAccountManagementModel } from "@/db/queries/account-management";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

export default async function AccountManagementPage() {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        closedMessage="Accounts remain closed until the signed-in portfolio owner is resolved."
        description="Create and manage custody accounts without mixing them with analysis groups."
        resolution={resolution}
        title="Account management"
      />
    );
  }

  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  const model = await getReadOnlyTenantAccountManagementModel({
    serviceDate,
    tenantContext: resolution.tenantContext,
  });
  const activeAccounts =
    model.state === "ready"
      ? model.accounts.filter((account) => account.isActive)
      : [];
  const archivedAccounts =
    model.state === "ready"
      ? model.accounts.filter((account) => !account.isActive)
      : [];

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-6 text-[#171916]">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <header className="border-b border-[#dfe3d5] pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                Account management
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687064]">
                Accounts represent custody locations such as a broker or pension
                account. Use asset groups separately when several accounts should
                be analyzed together.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/portfolio/holdings">Holdings</NavLink>
              <NavLink href="/portfolio/holdings/new">Add holding</NavLink>
              <NavLink href="/portfolio/groups">Asset groups</NavLink>
              <NavLink href="/portfolio/events?account=all">Events</NavLink>
            </nav>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <SummaryCell label="Service date" value={serviceDate} />
            <SummaryCell
              label="Active accounts"
              value={model.state === "ready" ? String(activeAccounts.length) : "-"}
            />
            <SummaryCell
              label="Archived accounts"
              value={
                model.state === "ready" ? String(archivedAccounts.length) : "-"
              }
            />
          </dl>
        </header>

        {model.state !== "ready" ? (
          <section className="rounded-md border border-[#ead9b5] bg-[#fff9eb] p-4 text-sm text-[#76591f]">
            Account data is temporarily unavailable. No write was attempted.
          </section>
        ) : (
          <>
            <section className="rounded-md border border-[#dfe3d5] bg-[#fbfcf7] p-4">
              <h2 className="text-lg font-semibold">Create an account</h2>
              <p className="mt-1 text-sm text-[#687064]">
                The immutable internal account code is generated on the server.
              </p>
              <div className="mt-4">
                <AccountCreateForm />
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Active accounts</h2>
                <p className="mt-1 text-sm text-[#687064]">
                  Renaming does not rewrite holdings, snapshots, or event history.
                </p>
              </div>
              {activeAccounts.length === 0 ? (
                <div className="rounded-md border border-[#dfe3d5] bg-[#fbfcf7] p-5 text-sm text-[#687064]">
                  Create the first account before adding a holding.
                </div>
              ) : (
                activeAccounts.map((account) => (
                  <AccountEditor
                    account={account}
                    key={`${account.id}:${account.updatedAt}`}
                  />
                ))
              )}
            </section>

            {archivedAccounts.length > 0 ? (
              <section className="space-y-3 border-t border-[#dfe3d5] pt-5">
                <div>
                  <h2 className="text-lg font-semibold">Archived accounts</h2>
                  <p className="mt-1 text-sm text-[#687064]">
                    Historical evidence remains stored and accounts can be restored.
                  </p>
                </div>
                {archivedAccounts.map((account) => (
                  <ArchivedAccountRow
                    account={account}
                    key={`${account.id}:${account.updatedAt}`}
                  />
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#dfe3d5] bg-white p-4">
      <dt className="text-xs font-semibold text-[#687064]">{label}</dt>
      <dd className="mt-2 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      className="rounded-md border border-[#cfd6c8] bg-white px-3 py-2 text-[#35423a] hover:bg-[#eef2e8]"
      href={href}
    >
      {children}
    </Link>
  );
}
