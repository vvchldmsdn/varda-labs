import Link from "next/link";
import type { ReactNode } from "react";

import type { ReadOnlyHistoryBalance } from "@/db/queries/history-balance";
import {
  buildBalanceHistoryTrajectory,
  buildPortfolioHistoryTrajectory,
} from "@/lib/history-trajectory";

import { HistoryControls } from "./history-controls";
import { formatHistoryDateRange } from "./history-format";
import { HistoryTrajectoryChart } from "./history-trajectory-chart";
import {
  BalanceHistoryTable,
  PortfolioHistoryTable,
} from "./history-tables";

export function HistoryView({ history }: { history: ReadOnlyHistoryBalance }) {
  const balanceTrajectory = buildBalanceHistoryTrajectory({
    rows: history.balanceRows,
    account: history.account,
  });
  const portfolioTrajectory = buildPortfolioHistoryTrajectory({
    rows: history.portfolioRows,
    account: history.account,
  });

  return (
    <main
      data-page="history"
      className="min-h-screen overflow-x-hidden bg-[#f3f4ef] text-[#171916]"
    >
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-4">
        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">
                Varda Labs
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                히스토리
              </h1>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">대시보드</NavLink>
              <NavLink href="/portfolio/structure">자산 배분</NavLink>
              <NavLink href="/portfolio/risk">위험·분산</NavLink>
            </nav>
          </div>

          <p
            data-history-semantic="stored-evidence-not-recomputed"
            className="mt-4 rounded-md border border-[#eadfc7] bg-[#fff8e7] px-3 py-2 text-sm text-[#6f561c]"
          >
            저장 당시의 기록을 그대로 읽습니다. 현재 보유 자산 정책으로
            과거 값을 다시 계산하지 않으며, 잔액 기록과 포트폴리오 성과를
            하나의 연속 시계열로 합치거나 보간하지 않습니다.
          </p>

          <HistoryControls account={history.account} lane={history.lane} />

          <div
            data-history-summary
            className="mt-4 grid border-t border-[#e1e6dc] md:grid-cols-4"
          >
            <SummaryCell
              label="잔액 기록"
              value={String(history.summary.balanceRowCount)}
              detail={formatHistoryDateRange(history.summary.balanceDateRange)}
            />
            <SummaryCell
              label="포트폴리오 기록"
              value={String(history.summary.portfolioRowCount)}
              detail={formatHistoryDateRange(history.summary.portfolioDateRange)}
            />
            <SummaryCell
              label="표시용 합산"
              value={String(history.summary.derivedPortfolioRowCount)}
              detail="DB에 쓰지 않은 화면 계산"
            />
            <SummaryCell
              label="공통 날짜"
              value={String(history.summary.overlappingDateCount)}
              detail="두 기록은 합치지 않음"
            />
          </div>
        </section>

        {history.lane !== "portfolio" ? (
          <section
            data-history-section="balance"
            className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
          >
            <SectionHeader title="잔액 기록" detail="저장된 잔액 증거" />
            <HistoryTrajectoryChart model={balanceTrajectory} />
            <BalanceHistoryTable
              rows={history.balanceRows}
              account={history.account}
            />
          </section>
        ) : null}

        {history.lane !== "balance" ? (
          <section
            data-history-section="portfolio"
            className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
          >
            <SectionHeader
              title="포트폴리오 성과"
              detail="저장값과 표시용 합산을 구분"
            />
            <HistoryTrajectoryChart model={portfolioTrajectory} />
            <PortfolioHistoryTable rows={history.portfolioRows} />
          </section>
        ) : null}
      </div>
    </main>
  );
}

function SummaryCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-b border-[#e1e6dc] px-3 py-3 md:border-b-0 md:border-r md:last:border-r-0">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-[#687064]">{detail}</p>
    </div>
  );
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      <p className="text-xs font-semibold text-[#687064]">{detail}</p>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-[#4d574b] hover:bg-[#eef2e8]"
    >
      {children}
    </Link>
  );
}
