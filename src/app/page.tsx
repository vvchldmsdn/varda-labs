import { Suspense } from "react";

import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import {
  getPortfolioDashboard,
  normalizeDashboardAccount,
} from "@/lib/portfolio-dashboard";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{
    account?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const selectedAccount = normalizeDashboardAccount(params.account);
  const dashboardPromise = getPortfolioDashboard(selectedAccount);

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent dashboardPromise={dashboardPromise} />
    </Suspense>
  );
}

async function DashboardContent({
  dashboardPromise,
}: {
  dashboardPromise: ReturnType<typeof getPortfolioDashboard>;
}) {
  const dashboard = await dashboardPromise;
  return <PortfolioDashboard data={dashboard} />;
}

function DashboardSkeleton() {
  return (
    <main className="min-h-screen bg-[#f3f4ef] p-4 text-[#171916]">
      <div className="mx-auto grid w-full max-w-[1600px] gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        <div className="h-80 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        <div className="space-y-4">
          <div className="h-48 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-96 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        </div>
        <div className="h-96 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
      </div>
    </main>
  );
}
