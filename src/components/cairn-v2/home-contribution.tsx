"use client";
import type { ReactNode } from "react";
import { instrumentLabel } from "@/lib/instrument-display";
import { RecoveryTitle } from "@/components/recovery/recovery-notice";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { eventNumber } from "@/lib/cairn-v2/event-display";
import home from "./home-contribution.module.css";
const DEFAULT_COLORS = ["#ef5a32", "#30362f", "#cda680", "#8b9d89", "#80909b", "#bdbbae"];
export function ContributionHome({ view, dirty = false, colors = DEFAULT_COLORS, children }: { view: BetaView; dirty?: boolean; colors?: readonly string[]; children?: ReactNode }) {
  const read = view.domain?.planning?.contribution;
  const result = !dirty && read?.state === "ready" ? read.result : null;
  const palette = colors.length ? colors : DEFAULT_COLORS;
  const segments = result
    ? result.rows
        .filter((row) => row.allocationKrw > 0)
        .map((row, index) => ({
          key: row.accountCode + ":" + index,
          name: instrumentLabel(row) + " · " + row.accountName,
          amount: row.allocationKrw,
          color: palette[index % palette.length],
        }))
    : [];
  if (result && result.residualCashKrw > 0)
    segments.push({
      key: "residual",
      name: "남는 현금",
      amount: result.residualCashKrw,
      color: "#dedfd8",
    });
  if (!result) return <p className={home.pending} role="status" data-contribution-state={dirty ? 'edited' : read?.state ?? view.domain?.state}>
    {dirty ? '변경한 금액으로 계산해 주세요' : read?.state === 'blocked' || read?.state === 'unavailable'
      ? <RecoveryTitle reasons={read.blockers} kind={read.state === 'unavailable' ? 'retry' : undefined} />
      : read?.message ?? '계산할 금액을 확인해 주세요'}
  </p>;
  return (
    <div
      className={home.surface}
      data-contribution-state={dirty ? "edited" : (read?.state ?? view.domain?.state)}
    >
      <div className={home.headline}>
        <div
          key={result.cashAmountKrw}
          className={home.amount}
          data-large={result.cashAmountKrw >= 1e9}
          title={eventNumber(result.cashAmountKrw) + " KRW"}
        >
          <span>{(result.cashAmountKrw / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}</span>
          <small>만원</small>
        </div>
        <p className={home.caption}>신규 투자금 · KRW</p>
      </div>
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
          {children}
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
            {segments.map((row, index) => (
              <span
                key={result.cashAmountKrw + ":" + row.key}
                data-funding-amount={row.amount}
                style={{
                  width:
                    (result.totalAvailableFundsKrw > 0
                      ? (row.amount / result.totalAvailableFundsKrw) * 100
                      : 0) + "%",
                  backgroundColor: row.color,
                  animationDelay: `${index * 40}ms`,
                }}
                title={row.name + " · " + eventNumber(row.amount) + " KRW"}
              />
            ))}
          </div>

      </>
    </div>
  );
}
