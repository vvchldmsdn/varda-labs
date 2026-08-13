import Link from "next/link";
import type { ReactNode } from "react";

import type { ReadOnlyHistoryBalance } from "@/db/queries/history-balance";
import type { TenantEventLedgerQueryResult } from "@/db/queries/tenant-events";
import {
  buildBalanceHistoryTrajectory,
  buildPortfolioHistoryTrajectory,
} from "@/lib/history-trajectory";

import { HistoryControls } from "./history-controls";
import { formatHistoryDateRange } from "./history-format";
import { HistoryPositionDetail } from "./history-position-detail";
import { HistoryPositionComparison } from "./history-position-comparison";
import { HistoryTrajectoryChart } from "./history-trajectory-chart";
import {
  BalanceHistoryTable,
  PortfolioHistoryTable,
} from "./history-tables";
import { TenantHistoryEvents } from "./tenant-history-events";

export function HistoryView({
  history,
  events,
  eventsSupported,
}: {
  history: ReadOnlyHistoryBalance;
  events: TenantEventLedgerQueryResult | null;
  eventsSupported: boolean;
}) {
  const balanceTrajectory = history.balanceAccount
    ? buildBalanceHistoryTrajectory({
        rows: history.balanceRows,
        account: history.balanceAccount,
      })
    : null;
  const portfolioTrajectory = buildPortfolioHistoryTrajectory({
    rows: history.portfolioRows,
    account: history.selectedScope.key,
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
            계좌 성과는 저장된 계좌 스냅샷을 읽고, 자산그룹 성과는 각
            기준일에 유효했던 멤버십과 포지션 스냅샷으로 계산합니다. 누락값을
            임의 보간하지 않으며 잔액 기록과 성과 시계열을 합치지 않습니다.
          </p>

          <HistoryControls
            lane={history.lane}
            scopes={history.analysisScopes}
            selectedScope={history.selectedScope}
          />

          {history.unavailableSources.length > 0 ? (
            <p className="mt-4 rounded-md border border-[#ead9b5] bg-[#fff9eb] px-3 py-2 text-sm text-[#76591f]">
              일부 기록을 읽지 못했습니다: {history.unavailableSources
                .map(historyReadSourceLabel)
                .join(", ")}. 읽을 수 있는 기록은 계속 표시합니다.
            </p>
          ) : null}

          {history.lane !== "events" ? (
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
                detail={formatHistoryDateRange(
                  history.summary.portfolioDateRange,
                )}
              />
              <SummaryCell
                label="표시용 합산"
                value={String(history.summary.derivedPortfolioRowCount)}
                detail={`부분 합산 ${history.summary.partialPortfolioRowCount}건`}
              />
              <SummaryCell
                label="공통 날짜"
                value={String(history.summary.overlappingDateCount)}
                detail="두 기록은 합치지 않음"
              />
            </div>
          ) : null}
        </section>

        {history.lane === "all" || history.lane === "balance" ? (
          <section
            data-history-section="balance"
            className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
          >
            <SectionHeader title="잔액 기록" detail="저장된 잔액 증거" />
            {balanceTrajectory && history.balanceAccount ? (
              <>
                <HistoryTrajectoryChart model={balanceTrajectory} />
                <BalanceHistoryTable
                  rows={history.balanceRows}
                  account={history.balanceAccount}
                />
              </>
            ) : (
              <UnsupportedScopeMessage>
                이 범위에는 배분 기준이 없는 레거시 잔액 기록을 적용하지
                않습니다. 포트폴리오 성과 기록은 아래에서 확인할 수 있습니다.
              </UnsupportedScopeMessage>
            )}
          </section>
        ) : null}

        {history.lane === "all" || history.lane === "portfolio" ? (
          <section
            data-history-section="portfolio"
            className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
          >
            <SectionHeader
              title="포트폴리오 성과"
              detail="저장값과 표시용 합산을 구분"
            />
            <HistoryTrajectoryChart model={portfolioTrajectory} />
            {history.selectedScope.kind === "account" ? (
              <>
                <HistoryPositionComparison
                  model={history.positionComparison}
                  scopeKey={history.selectedScope.key}
                />
                <HistoryPositionDetail
                  model={history.positionDetail}
                  scopeKey={history.selectedScope.key}
                />
              </>
            ) : (
              <UnsupportedScopeMessage>
                전체·자산그룹의 과거 보유 상세 비교는 계좌 경계를 넘어서는
                별도 증거 모델이 필요해 이번 단계에서는 표시하지 않습니다.
              </UnsupportedScopeMessage>
            )}
            <PortfolioHistoryTable
              rows={history.portfolioRows}
              lane={history.lane}
              positionDetail={history.positionDetail}
              selectedScope={history.selectedScope}
            />
          </section>
        ) : null}

        {history.lane === "all" || history.lane === "events" ? (
          <section
            data-history-section="events"
            className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
          >
            <SectionHeader
              title="저장 이벤트"
              detail="소유 계정에 명시적으로 연결된 저장 근거"
            />
            {events ? (
              <TenantHistoryEvents result={events} />
            ) : !eventsSupported ? (
              <UnsupportedScopeMessage>
                이 자산그룹의 이벤트 포함 규칙은 아직 정의되지 않아 기존 계좌
                이벤트를 임의로 합산하지 않습니다.
              </UnsupportedScopeMessage>
            ) : (
              <p className="mt-4 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
                이벤트 조회가 시작되지 않았습니다.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function UnsupportedScopeMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
      {children}
    </p>
  );
}

function historyReadSourceLabel(
  source: ReadOnlyHistoryBalance["unavailableSources"][number],
) {
  if (source === "balance") return "잔액";
  if (source === "portfolio") return "포트폴리오";
  if (source === "position_detail") return "포지션 상세";
  return "포지션 비교";
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
