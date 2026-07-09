import { Suspense } from "react";

import { TodayMovement } from "@/components/today-movement";
import {
  getPortfolioDashboard,
  normalizeDashboardAccount,
} from "@/lib/portfolio-dashboard";
import { normalizeTodayHoldingDetailQuery } from "@/lib/today-holding-detail";

export const dynamic = "force-dynamic";

type TodayPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    ticker?: string | string[];
    market?: string | string[];
  }>;
};

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const params = await searchParams;
  const selectedAccount = normalizeDashboardAccount(params.account);
  const detailQuery = normalizeTodayHoldingDetailQuery(params);
  const dashboardPromise = getPortfolioDashboard(selectedAccount);

  return (
    <Suspense fallback={<TodaySkeleton />}>
      <TodayContent
        dashboardPromise={dashboardPromise}
        detailQuery={detailQuery}
      />
    </Suspense>
  );
}

async function TodayContent({
  dashboardPromise,
  detailQuery,
}: {
  dashboardPromise: ReturnType<typeof getPortfolioDashboard>;
  detailQuery: ReturnType<typeof normalizeTodayHoldingDetailQuery>;
}) {
  const dashboard = await dashboardPromise;
  return <TodayMovement data={dashboard} detailQuery={detailQuery} />;
}

function TodaySkeleton() {
  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-4 text-[#171916]">
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <div className="h-32 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        </div>
        <div className="h-80 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
      </div>
    </main>
  );
}
