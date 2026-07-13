import Link from "next/link";

import { InvestmentLabComparisonChart } from "./investment-lab-comparison-chart";
import type { InvestmentLabCounterfactualReadModel } from "@/lib/investment-lab-counterfactual-read-model";

export function InvestmentLabView({
  model,
}: {
  model: InvestmentLabCounterfactualReadModel;
}) {
  return (
    <main
      className="min-h-screen bg-[#f3f4ef] text-[#171916]"
      data-page="investment-lab"
    >
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-4">
        <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal sm:text-3xl">
                투자 랩
              </h1>
              <p className="mt-2 text-sm text-[#626b5f]">
                실제 평가액과 동일한 거래금액을 전액 KODEX 200에 적용한 경로 비교
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">홈</NavLink>
              <NavLink href="/today">오늘 변동</NavLink>
              <NavLink href="/portfolio/structure">포트 구조</NavLink>
              <NavLink href="/history">히스토리</NavLink>
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <StatusPill label="계정" value="전체" />
            <StatusPill label="시나리오" value="전액 KODEX 200" />
            <StatusPill
              label="상태"
              value={model.status === "ready" ? "계산 가능" : "계산 차단"}
            />
          </div>
        </header>

        {model.status === "ready" && model.summary ? (
          <ReadyView model={model} />
        ) : (
          <BlockedView model={model} />
        )}
      </div>
    </main>
  );
}

function ReadyView({ model }: { model: InvestmentLabCounterfactualReadModel }) {
  const summary = model.summary!;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell
          label="실제 최종 평가액"
          value={formatKrw(summary.actualEndValueKrw)}
          detail={formatDate(summary.endServiceDate)}
        />
        <SummaryCell
          label="KODEX 200 최종 평가액"
          value={formatKrw(summary.scenarioEndValueKrw)}
          detail="동일 거래금액 반영"
        />
        <SummaryCell
          label="최종 차이"
          value={formatSignedKrw(summary.endDifferenceKrw)}
          detail="가상 경로 - 실제 경로"
          tone={summary.endDifferenceKrw >= 0 ? "positive" : "negative"}
        />
        <SummaryCell
          label="비교 구간"
          value={`${summary.comparisonDateCount}개 평가일`}
          detail={`${formatDate(summary.startServiceDate)} ~ ${formatDate(summary.endServiceDate)}`}
        />
      </section>

      <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">평가액 경로 비교</h2>
            <p className="mt-1 text-sm text-[#687064]">
              저장된 전체 계정 평가일 기준, 거래비용 0원·소수점 수량 허용
            </p>
          </div>
          <p className="text-sm text-[#687064]">
            KODEX 200 종가 최대 이월 {model.coverage.maxValuationCarryDays ?? 0}일
          </p>
        </div>
        <InvestmentLabComparisonChart rows={model.rows} />
        {model.coverage.pendingComparisonRows > 0 ? (
          <p className="mt-3 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-3 py-2 text-sm text-[#725f2d]">
            지연 체결 표시가 있는 {model.coverage.pendingComparisonRows}개 평가일은 가상 경로의 대기 현금 또는 매도 의무를 평가액에 포함하지 않습니다.
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
        <div className="flex flex-col gap-1 border-b border-[#e1e6dc] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">비교 데이터</h2>
            <p className="mt-1 text-sm text-[#687064]">
              현금흐름 조정 수익률은 아직 표시하지 않습니다.
            </p>
          </div>
          <p className="text-sm text-[#687064]">
            기간 내 반영 거래 {model.coverage.appliedFlowRows}건 · 지연 체결 {model.coverage.delayedExecutionRows}건
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
                <th className="px-4 py-3">평가일</th>
                <th className="px-3 py-3 text-right">실제 평가액</th>
                <th className="px-3 py-3 text-right">KODEX 200</th>
                <th className="px-3 py-3 text-right">차이</th>
                <th className="px-4 py-3">가격 기준</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.serviceDate} className="border-t border-[#e1e6dc]">
                  <td className="px-4 py-3 font-medium">{formatDate(row.serviceDate)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatKrw(row.actualMarketValueKrw)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatKrw(row.scenarioMarketValueKrw)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-semibold tabular-nums ${moneyTone(row.differenceKrw)}`}
                  >
                    {formatSignedKrw(row.differenceKrw)}
                  </td>
                  <td className="px-4 py-3 text-[#687064]">
                    {formatDate(row.valuationPriceDate)}
                    {row.hasPendingExecution ? " · 지연 체결" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <h2 className="text-lg font-semibold">데이터 상태</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <EvidenceCell label="완전한 비교일" value={`${model.coverage.completeComparisonDates}일`} />
          <EvidenceCell label="평가 스냅샷" value={`${model.coverage.snapshotSourceRows}행`} />
          <EvidenceCell label="KODEX 200 종가" value={`${model.coverage.scenarioCloseRows}행`} />
          <EvidenceCell label="종료 시 대기 거래" value={`${model.coverage.pendingAtEndRows}건`} />
        </div>
      </section>
    </>
  );
}

function BlockedView({ model }: { model: InvestmentLabCounterfactualReadModel }) {
  return (
    <section className="rounded-lg border border-[#eadfbe] bg-[#fff9e8] p-5">
      <h2 className="text-lg font-semibold text-[#5f5027]">현재 계산할 수 없습니다</h2>
      <p className="mt-2 text-sm text-[#725f2d]">
        일부 결과를 추정해서 표시하지 않고 입력 증거를 차단했습니다.
      </p>
      <ul className="mt-4 space-y-2 text-sm text-[#725f2d]">
        {model.blockers.map((blocker) => (
          <li key={blocker}>{blockerLabel(blocker)}</li>
        ))}
      </ul>
    </section>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#dce2d2] bg-white px-3 py-2 text-[#394138] hover:bg-[#edf1e8]"
    >
      {children}
    </Link>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-[#dce2d2] bg-white px-3 py-2 text-[#5d665b]">
      {label} <strong className="ml-1 text-[#1e2821]">{value}</strong>
    </span>
  );
}

function SummaryCell({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <p className="text-sm text-[#687064]">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold tabular-nums ${
          tone === "positive"
            ? "text-[#087f4f]"
            : tone === "negative"
              ? "text-[#c43d39]"
              : "text-[#171916]"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function blockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    snapshot_evidence_invalid: "평가 스냅샷 형식 또는 중복을 확인해야 합니다.",
    actual_path_reconciliation_mismatch: "저장된 전체 평가액과 계정별 합계가 일치하지 않습니다.",
    actual_path_incomplete: "비교 가능한 전체 계정 평가일이 부족합니다.",
    event_evidence_unsupported: "거래 금액 또는 이벤트 유형을 확인해야 합니다.",
    scenario_close_evidence_invalid: "KODEX 200 조정종가 증거를 확인해야 합니다.",
    flow_schedule_blocked: "거래일 이후 7일 안에 체결 가능한 종가가 없습니다.",
    path_calculation_blocked: "가상 경로 계산의 보존 조건을 충족하지 못했습니다.",
    pending_flows_at_window_end: "마지막 평가일까지 처리되지 않은 거래가 있습니다.",
  };
  return labels[blocker] ?? "입력 증거를 확인해야 합니다.";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatKrw(value: number) {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatSignedKrw(value: number) {
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}₩${Math.round(Math.abs(value)).toLocaleString("ko-KR")}`;
}

function moneyTone(value: number) {
  return value > 0
    ? "text-[#087f4f]"
    : value < 0
      ? "text-[#c43d39]"
      : "text-[#5d665b]";
}
