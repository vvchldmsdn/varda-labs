"use client";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { eventNumber } from "@/lib/cairn-v2/event-display";
import home from "./home-contribution.module.css";
export function ContributionHome({ view, dirty = false }: { view: BetaView; dirty?: boolean }) {
  const read = view.domain?.planning?.contribution;
  const result = !dirty && read?.state === "ready" ? read.result : null;
  const colors = ["#ef5a32", "#30362f", "#cda680", "#8b9d89", "#80909b", "#bdbbae"];
  const segments = result
    ? result.rows
        .filter((row) => row.allocationKrw > 0)
        .map((row, index) => ({
          key: row.accountCode + ":" + index,
          name: row.name + " · " + row.accountName,
          amount: row.allocationKrw,
          color: colors[index % colors.length],
        }))
    : [];
  if (result && result.residualCashKrw > 0)
    segments.push({
      key: "residual",
      name: "남는 현금",
      amount: result.residualCashKrw,
      color: "#dedfd8",
    });
  return (
    <div
      className={home.surface}
      data-contribution-state={dirty ? "edited" : (read?.state ?? view.domain?.state)}
    >
      <div className={home.headline}>
        <div
          className={home.amount}
          data-large={!!result && result.cashAmountKrw >= 1e9}
          title={result ? eventNumber(result.cashAmountKrw) + " KRW" : undefined}
        >
          <span>
            {result
              ? (result.cashAmountKrw / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 4 })
              : "—"}
          </span>
          {result && <small>만원</small>}
        </div>
        <p className={home.caption}>
          {result
            ? "신규 투자금 · KRW"
            : dirty
              ? "입력 변경 · 계산 대기"
              : (read?.message ?? "계산 대기")}
        </p>
      </div>
      {result && (
        <>
          <dl className={home.summary}>
            <div>
              <dt>총 매수 배분</dt>
              <dd>
                {eventNumber(result.totalAllocatedKrw)}
                <small>원</small>
              </dd>
            </div>
            <div>
              <dt>남는 현금</dt>
              <dd>
                {eventNumber(result.residualCashKrw)}
                <small>원</small>
              </dd>
            </div>
          </dl>
          <div
            className={home.allocation}
            role="img"
            aria-label={
              "총 배분 재원 " +
              eventNumber(result.totalAvailableFundsKrw) +
              " KRW. " +
              (segments.length
                ? segments
                    .map((row) => row.name + " " + eventNumber(row.amount) + " KRW")
                    .join(". ")
                : "매수 배분과 남는 현금 0 KRW")
            }
          >
            {segments.map((row) => (
              <span
                key={row.key}
                data-funding-amount={row.amount}
                style={{
                  width:
                    (result.totalAvailableFundsKrw > 0
                      ? (row.amount / result.totalAvailableFundsKrw) * 100
                      : 0) + "%",
                  backgroundColor: row.color,
                }}
                title={row.name + " · " + eventNumber(row.amount) + " KRW"}
              />
            ))}
          </div>
          {result.totalTrimProceedsKrw > 0 && (
            <p className={home.funding}>
              계산상 매도 {eventNumber(result.totalTrimProceedsKrw)}원
              <span>총 재원 {eventNumber(result.totalAvailableFundsKrw)}원</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
