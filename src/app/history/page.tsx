import Link from "next/link";

import { HistoryView } from "@/components/history/history-view";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantEvents } from "@/db/queries/tenant-events";
import { getReadOnlyTenantHistoryBalance } from "@/db/queries/history-balance";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { normalizeHistoryLane } from "@/lib/history-balance";
import { normalizeHistoryPositionSelection } from "@/lib/history-position-detail";
import { normalizeHistoryPositionComparisonSelection } from "@/lib/history-position-comparison";
import {
  isNamedPortfolioAccount,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";

export const dynamic = "force-dynamic";

type HistoryPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
    lane?: string | string[];
    positionDate?: string | string[];
    positionSource?: string | string[];
    comparisonFrom?: string | string[];
    comparisonTo?: string | string[];
  }>;
};

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const lane = normalizeHistoryLane(params.lane);

  if (!resolution.ok) {
    return <HistoryAccessBoundary resolution={resolution} />;
  }

  const scopeContext = await getReadOnlyTenantPortfolioAnalysisScopeContext({
    account: params.account,
    scope: params.scope,
    tenantContext: resolution.tenantContext,
  });
  if (
    scopeContext.state !== "ready" ||
    scopeContext.resolution.state !== "resolved"
  ) {
    return (
      <PortfolioAnalysisScopeBoundary
        basePath="/history"
        context={scopeContext}
        title="히스토리"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  const positionAccount =
    selectedScope.kind === "account" ? selectedScope.accountCode : "all";
  const eventScope = legacyEventScope(selectedScope);

  const positionSelection = normalizeHistoryPositionSelection({
    account: positionAccount,
    lane,
    positionDate: params.positionDate,
    positionSource: params.positionSource,
  });
  const positionComparisonSelection =
    normalizeHistoryPositionComparisonSelection({
      account: positionAccount,
      lane,
      comparisonFrom: params.comparisonFrom,
      comparisonTo: params.comparisonTo,
    });
  const [history, events] = await Promise.all([
    getReadOnlyTenantHistoryBalance({
      analysisScopes: scopeContext.catalog.scopes,
      tenantContext: resolution.tenantContext,
      scope: selectedScope,
      lane,
      positionSelection,
      positionComparisonSelection,
    }),
    eventScope !== null && (lane === "all" || lane === "events")
      ? getReadOnlyTenantEvents({
          tenantContext: resolution.tenantContext,
          scope: eventScope,
        })
      : Promise.resolve(null),
  ]);

  return (
    <HistoryView
      events={events}
      eventsSupported={eventScope !== null}
      generatedAt={new Date().toISOString()}
      history={history}
    />
  );
}

function legacyEventScope(
  scope: PortfolioAnalysisScope,
): PortfolioAccountScope | null {
  if (scope.kind === "all") return "all";
  if (
    scope.kind === "account" &&
    isNamedPortfolioAccount(scope.accountCode)
  ) {
    return scope.accountCode;
  }
  return null;
}

function HistoryAccessBoundary({
  resolution,
}: {
  resolution: SessionResolverResult;
}) {
  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">
          히스토리
        </h1>
        <p className="mt-2 text-sm text-[#687064]">
          로그인 세션과 사용자 소유권이 확인된 기록만 조회합니다.
        </p>
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <EvidenceCell
            label="사용자 연결"
            value={sessionResolutionEvidence(resolution)}
          />
          <EvidenceCell label="상품 데이터 조회" value="시도하지 않음" />
        </dl>
        <p className="mt-6 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
          로그인과 사용자 연결이 확인되기 전에는 히스토리 데이터를 읽지
          않습니다.
        </p>
        <Link
          href="/auth/sign-in"
          className="mt-5 inline-flex rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
        >
          로그인
        </Link>
      </section>
    </main>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#dfe3d5] bg-white p-4">
      <dt className="text-xs font-semibold text-[#687064]">{label}</dt>
      <dd className="mt-2 font-semibold">{value}</dd>
    </div>
  );
}
