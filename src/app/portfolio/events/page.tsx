import Link from "next/link";

import { AccountScopeTabs } from "@/components/account-scope-tabs";
import { TenantEventSummary } from "@/components/events/tenant-event-summary";
import { TenantEventTable } from "@/components/events/tenant-event-table";
import {
  getReadOnlyTenantEvents,
  type TenantEventLedgerQueryResult,
} from "@/db/queries/tenant-events";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { normalizePortfolioAccountScope } from "@/lib/portfolio-account-scope";
import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";

export const dynamic = "force-dynamic";

type TenantEventsPageProps = {
  searchParams: Promise<{
    account?: string | string[];
  }>;
};

export default async function TenantEventsPage({
  searchParams,
}: TenantEventsPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const scope = normalizePortfolioAccountScope(params.account);
  const result = resolution.ok
    ? await getReadOnlyTenantEvents({
        tenantContext: resolution.tenantContext,
        scope,
      })
    : null;
  const evidence = isEvidenceResult(result) ? result : null;

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-6xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              소유 계정 이벤트
            </h1>
            <p className="mt-2 text-sm text-[#687064]">
              소유권이 확인된 계정 연결을 통해 읽은 거래 및 자산 상태 근거
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="관련 근거 화면">
            <PageLink href="/portfolio/accounts?account=all">계정</PageLink>
            <PageLink href="/portfolio/holdings?account=all">보유 종목</PageLink>
            <PageLink href="/portfolio/position-snapshots?account=all">
              포지션 스냅샷
            </PageLink>
            <PageLink href="/auth/session">세션 근거</PageLink>
          </nav>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe3d5] pt-6">
          <p className="text-sm font-semibold">
            {eventReadEvidence(result, resolution)}
          </p>
          <AccountScopeTabs
            basePath="/portfolio/events"
            selectedAccount={scope}
          />
        </div>

        {evidence ? (
          <>
            <p className="mt-4 rounded-md border border-[#dfe3d5] bg-[#eef2e8] p-3 text-sm text-[#465247]">
              이 화면은 account_id로 소유 계정에 연결된 이벤트만 표시합니다.
              연결되지 않은 레거시 행은 account 문자열만으로 소유권을 추론하지
              않습니다.
            </p>
            {evidence.state === "partial" ? (
              <p className="mt-3 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
                일부 이벤트의 표시 근거가 불완전하거나 표시 한도를 넘었습니다.
                유효한 행은 유지했지만 이 결과를 전체 거래 원장으로 사용하면 안
                됩니다.
              </p>
            ) : null}
            <TenantEventSummary result={evidence} />
            <TenantEventTable events={evidence.events} />
          </>
        ) : result?.state === "no_data" ? (
          <p className="mt-5 rounded-md border border-[#dfe3d5] bg-[#eef2e8] p-3 text-sm text-[#465247]">
            이 계정 범위에는 account_id로 소유 계정에 연결된 이벤트가 없습니다.
            연결되지 않은 레거시 행은 소유권을 추론하지 않아 표시하지 않습니다.
          </p>
        ) : (
          <p className="mt-5 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
            세션, 소유 계정 연결, 행 무결성 검증이 모두 통과할 때까지 이벤트
            데이터는 닫힌 상태로 유지됩니다.
          </p>
        )}
      </section>
    </main>
  );
}

function PageLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
    >
      {children}
    </Link>
  );
}

function eventReadEvidence(
  result: TenantEventLedgerQueryResult | null,
  resolution: SessionResolverResult,
) {
  if (result === null) {
    return `${sessionResolutionEvidence(resolution)}; 이벤트 데이터를 읽지 않았습니다.`;
  }
  if (result.state === "unavailable") return "이벤트 읽기를 사용할 수 없습니다.";
  if (result.state === "integrity_error") return "이벤트 읽기가 차단됐습니다.";
  if (result.state === "no_data") {
    return "이 계정 범위에 연결된 이벤트가 없습니다.";
  }
  const status = result.state === "partial" ? "부분 근거" : "검증 통과";
  return `${result.eventCount}건의 소유 계정 이벤트, ${status}`;
}

function isEvidenceResult(
  result: TenantEventLedgerQueryResult | null,
): result is Extract<TenantEventLedgerQueryResult, { state: "ready" | "partial" }> {
  return result?.state === "ready" || result?.state === "partial";
}
