import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";

import { HoldingAnalysisDataForm } from "@/components/holding-analysis-data-form";
import {
  HoldingArchiveForm,
  HoldingRestoreForm,
} from "@/components/holding-lifecycle-forms";
import { HoldingStateCorrectionForm } from "@/components/holding-state-correction-form";
import { ManualKrxGoldPriceForm } from "@/components/manual-krx-gold-price-form";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import {
  getReadOnlyTenantPortfolioAnalysisScopeContext,
  type TenantPortfolioAnalysisScopeContextResult,
} from "@/db/queries/portfolio-analysis-scopes";
import {
  getReadOnlyTenantHoldingAnalysisDataReadiness,
} from "@/db/queries/holding-analysis-data-readiness";
import {
  getReadOnlyTenantHoldings,
  type TenantHoldingQueryResult,
} from "@/db/queries/tenant-holdings";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { isKrxGoldManualAssetCandidate } from "@/lib/market-data/manual-asset-price";
import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

type TenantHoldingsPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function TenantHoldingsPage({
  searchParams,
}: TenantHoldingsPageProps) {
  const [params, tenantResolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const serviceDate = resolveSnapshotCycle().snapshotDate;
  const scopeContext = tenantResolution.ok
    ? await getReadOnlyTenantPortfolioAnalysisScopeContext({
        account: params.account,
        scope: params.scope,
        tenantContext: tenantResolution.tenantContext,
      })
    : null;
  const selectedScope =
    scopeContext?.state === "ready" &&
    scopeContext.resolution.state === "resolved"
      ? scopeContext.resolution.scope
      : null;
  const result = tenantResolution.ok && selectedScope
    ? await getReadOnlyTenantHoldings({
        serviceDate,
        scope: selectedScope,
        tenantContext: tenantResolution.tenantContext,
      })
    : null;
  const visibleHoldings =
    result?.state === "ready" || result?.state === "partial"
      ? result.holdings
      : [];
  const activeHoldings = visibleHoldings.filter(
    (holding) => holding.archivedAt === null,
  );
  const archivedHoldings = visibleHoldings.filter(
    (holding) => holding.archivedAt !== null,
  );
  const analysisDataResult =
    tenantResolution.ok && activeHoldings.length > 0
      ? await getReadOnlyTenantHoldingAnalysisDataReadiness({
          tenantContext: tenantResolution.tenantContext,
          serviceDate,
          holdings: activeHoldings.map((holding) => ({
            holdingId: holding.holdingId,
            accountCode: holding.accountCode,
            name: holding.name,
            ticker: holding.ticker,
            assetType: holding.assetType,
            market: holding.market,
            currency: holding.currency,
          })),
        })
      : null;
  const analysisDataByHolding = new Map(
    analysisDataResult?.state === "ready"
      ? analysisDataResult.entries.map((entry) => [entry.holdingId, entry])
      : [],
  );

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-10 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-5xl rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              Owner-scoped holdings
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Stored asset evidence through owned account relationships
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/portfolio/holdings/new"
              className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ink)]"
            >
              보유종목 추가
            </Link>
            <Link
              href="/portfolio/groups"
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
            >
              자산 그룹
            </Link>
            <Link
              href="/portfolio/accounts?account=all"
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
            >
              Accounts
            </Link>
            <Link
              href="/portfolio/position-snapshots?account=all"
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
            >
              Position snapshots
            </Link>
            <Link
              href="/portfolio/portfolio-snapshots?account=all"
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
            >
              Portfolio snapshots
            </Link>
            <Link
              href="/auth/session"
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
            >
              Session evidence
            </Link>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-6">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">조회 범위</p>
            <p className="mt-1 text-sm font-semibold">
              {selectedScope?.label ?? "범위를 확인할 수 없습니다"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {holdingReadEvidence(
                result,
                tenantResolution,
                scopeContext,
              )}
            </p>
          </div>
          {scopeContext?.state === "ready" ? (
            <PortfolioAnalysisScopeTabs
              basePath="/portfolio/holdings"
              scopes={scopeContext.catalog.scopes}
              selectedScopeKey={selectedScope?.key ?? null}
            />
          ) : null}
        </div>

        {result?.state === "ready" || result?.state === "partial" ? (
          <div className="mt-5 overflow-x-auto rounded-md border border-[var(--line)] bg-white">
            {result.state === "partial" ? (
              <p className="border-b border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
                This is a partial evidence list. Excluded rows remain visible in
                the count, and this result must not be used for valuation totals.
              </p>
            ) : null}
            <table className="min-w-[1320px] w-full border-collapse text-left text-sm">
              <thead className="bg-[var(--wash)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Holding</th>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">Market</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Quantity
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Average cost
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Stored price
                  </th>
                  <th className="px-4 py-3 font-semibold">Price evidence</th>
                  <th className="px-4 py-3 font-semibold">분석 데이터</th>
                  <th className="px-4 py-3 font-semibold">Correction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--wash)]">
                {activeHoldings.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-[var(--muted)]" colSpan={9}>
                      이 범위에 현재 보유 중인 종목이 없습니다.
                    </td>
                  </tr>
                ) : (
                  activeHoldings.map((holding) => (
                    <tr key={holding.holdingId}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{holding.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {holding.ticker ?? "No ticker"}
                          {holding.assetType ? ` / ${holding.assetType}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{holding.accountName}</p>
                        <p className="text-xs text-[var(--muted)]">
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
                        {holding.averageCost === null
                          ? "Not recorded"
                          : `${holding.averageCost} ${holding.currency}`}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {holding.currentPrice} {holding.currency}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        <p>{holding.priceStatus ?? "No status"}</p>
                        <p>{holding.priceSource ?? "No source"}</p>
                        <p>{formatPriceAsOf(holding.priceAsOf)}</p>
                        {isKrxGoldManualAssetCandidate(holding) ? (
                          <ManualKrxGoldPriceForm
                            key={holding.currentPrice}
                            currentPrice={holding.currentPrice}
                          />
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <HoldingAnalysisDataForm
                          holdingId={holding.holdingId}
                          readiness={
                            analysisDataByHolding.get(holding.holdingId) ?? null
                          }
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <HoldingStateCorrectionForm
                          averageCost={holding.averageCost}
                          currency={holding.currency}
                          holdingId={holding.holdingId}
                          quantity={holding.quantity}
                          updatedAt={holding.updatedAt}
                        />
                        <HoldingArchiveForm
                          holdingId={holding.holdingId}
                          updatedAt={holding.updatedAt}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
            Holdings remain closed until the session, owner relationship, and
            row integrity checks all pass.
          </p>
        )}

        {(result?.state === "ready" || result?.state === "partial") &&
        archivedHoldings.length > 0 ? (
          <section className="mt-8 border-t border-[var(--line)] pt-6">
            <div>
              <h2 className="text-lg font-semibold">종료된 보유종목</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                평가와 분석에서는 제외되며 수량·매입원가·과거 기록은 보존됩니다.
              </p>
            </div>
            <div className="mt-4 overflow-x-auto rounded-md border border-[var(--line)] bg-white">
              <table className="min-w-[820px] w-full border-collapse text-left text-sm">
                <thead className="bg-[var(--wash)] text-xs text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Holding</th>
                    <th className="px-4 py-3 font-semibold">Account</th>
                    <th className="px-4 py-3 font-semibold">종료 시각</th>
                    <th className="px-4 py-3 text-right font-semibold">수량</th>
                    <th className="px-4 py-3 font-semibold">복원</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--wash)]">
                  {archivedHoldings.map((holding) => (
                    <tr key={holding.holdingId}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{holding.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {holding.ticker ?? "No ticker"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{holding.accountName}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {holding.accountCode}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        {formatPriceAsOf(holding.archivedAt)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {holding.quantity}
                      </td>
                      <td className="px-4 py-3">
                        <HoldingRestoreForm
                          holdingId={holding.holdingId}
                          updatedAt={holding.updatedAt}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function holdingReadEvidence(
  result: TenantHoldingQueryResult | null,
  tenantResolution: SessionResolverResult,
  scopeContext: TenantPortfolioAnalysisScopeContextResult | null,
) {
  if (!tenantResolution.ok) {
    return `${sessionResolutionEvidence(tenantResolution)}; product data was not read.`;
  }
  if (scopeContext === null || scopeContext.state === "unavailable") {
    return "Analysis scope read unavailable.";
  }
  if (scopeContext.state === "integrity_error") {
    return "Analysis scope read blocked by catalog integrity checks.";
  }
  if (scopeContext.resolution.state === "blocked") {
    return "Analysis scope input was blocked without falling back to all holdings.";
  }
  if (result === null) return "Holdings were not read.";
  if (result.state === "unavailable") return "Holdings read unavailable.";
  if (result.state === "integrity_error") return "Holdings read blocked.";
  const activeCount = result.holdings.filter(
    (holding) => holding.archivedAt === null,
  ).length;
  const archivedCount = result.holdings.length - activeCount;
  const included = `${activeCount} active holding${
    activeCount === 1 ? "" : "s"
  }; ${archivedCount} archived`;
  return result.state === "ready"
    ? included
    : `${included}; partial evidence, ${result.excludedHoldingCount} invalid row${
        result.excludedHoldingCount === 1 ? "" : "s"
      } excluded`;
}

function formatPriceAsOf(value: string | null) {
  if (value === null) return "No timestamp";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
