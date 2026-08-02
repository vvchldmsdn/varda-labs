import Link from "next/link";

import { AccountScopeTabs } from "@/components/account-scope-tabs";
import {
  getReadOnlyTenantHoldings,
  type TenantHoldingQueryResult,
} from "@/db/queries/tenant-holdings";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { normalizePortfolioAccountScope } from "@/lib/portfolio-account-scope";
import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";

export const dynamic = "force-dynamic";

type TenantHoldingsPageProps = {
  searchParams: Promise<{
    account?: string | string[];
  }>;
};

export default async function TenantHoldingsPage({
  searchParams,
}: TenantHoldingsPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const scope = normalizePortfolioAccountScope(params.account);
  const result = resolution.ok
    ? await getReadOnlyTenantHoldings({
        tenantContext: resolution.tenantContext,
        scope,
      })
    : null;

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-5xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              Owner-scoped holdings
            </h1>
            <p className="mt-2 text-sm text-[#687064]">
              Stored asset evidence through owned account relationships
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/portfolio/accounts?account=all"
              className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
            >
              Accounts
            </Link>
            <Link
              href="/auth/session"
              className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
            >
              Session evidence
            </Link>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe3d5] pt-6">
          <p className="text-sm font-semibold">
            {holdingReadEvidence(result, resolution)}
          </p>
          <AccountScopeTabs
            basePath="/portfolio/holdings"
            selectedAccount={scope}
          />
        </div>

        {result?.state === "ready" ? (
          <div className="mt-5 overflow-x-auto rounded-md border border-[#dfe3d5] bg-white">
            <table className="min-w-[760px] w-full border-collapse text-left text-sm">
              <thead className="bg-[#eef2e8] text-xs text-[#5e685e]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Holding</th>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">Market</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Quantity
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Stored price
                  </th>
                  <th className="px-4 py-3 font-semibold">Price evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e8df]">
                {result.holdings.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-[#687064]" colSpan={6}>
                      No owned holdings are linked to this account scope.
                    </td>
                  </tr>
                ) : (
                  result.holdings.map((holding, index) => (
                    <tr
                      key={`${holding.accountCode}:${holding.market}:${holding.ticker ?? holding.name}:${index}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold">{holding.name}</p>
                        <p className="text-xs text-[#687064]">
                          {holding.ticker ?? "No ticker"}
                          {holding.assetType ? ` / ${holding.assetType}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{holding.accountName}</p>
                        <p className="text-xs text-[#687064]">
                          {holding.accountCode}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {holding.market} / {holding.currency}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {holding.quantity}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {holding.currentPrice} {holding.currency}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#687064]">
                        <p>{holding.priceStatus ?? "No status"}</p>
                        <p>{holding.priceSource ?? "No source"}</p>
                        <p>{formatPriceAsOf(holding.priceAsOf)}</p>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
            Holdings remain closed until the session, owner relationship, and
            row integrity checks all pass.
          </p>
        )}
      </section>
    </main>
  );
}

function holdingReadEvidence(
  result: TenantHoldingQueryResult | null,
  resolution: SessionResolverResult,
) {
  if (result === null) {
    return `${sessionResolutionEvidence(resolution)}; product data was not read.`;
  }
  if (result.state === "unavailable") return "Holdings read unavailable.";
  if (result.state === "integrity_error") return "Holdings read blocked.";
  const included = `${result.holdings.length} owned holding${
    result.holdings.length === 1 ? "" : "s"
  }`;
  return result.excludedHoldingCount === 0
    ? included
    : `${included}; ${result.excludedHoldingCount} invalid row${
        result.excludedHoldingCount === 1 ? "" : "s"
      } excluded`;
}

function formatPriceAsOf(value: string | null) {
  if (value === null) return "No timestamp";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
