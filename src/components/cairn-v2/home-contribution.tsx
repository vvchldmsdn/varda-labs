"use client";
import { instrumentLabel } from "@/lib/instrument-display";
import { RecoveryTitle } from "@/components/recovery/recovery-notice";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { eventNumber } from "@/lib/cairn-v2/event-display";
import { useContributionOrderPlan } from "./contribution-order-context";
import home from "./home-contribution.module.css";
const DEFAULT_COLORS = ["#ef5a32", "#30362f", "#cda680", "#8b9d89", "#80909b", "#bdbbae"];
export function ContributionHome({ view, dirty = false, colors = DEFAULT_COLORS, pendingAmount }: {
  view: BetaView;
  dirty?: boolean;
  colors?: readonly string[];
  pendingAmount?: number | null;
}) {
  const read = view.domain?.planning?.contribution;
  const result = !dirty && read?.state === "ready" ? read.result : null;
  const order = useContributionOrderPlan(read?.orderBasis).projection?.result;
  const sized = read?.orderBasis && order && order.status !== "unavailable" ? order : null;
  const sizedByKey = new Map(sized?.orders.map(row => [row.key, row]));
  const budget = sized ? read!.orderBasis!.budgetKrw : result?.totalAvailableFundsKrw ?? 0;
  const cash = sized?.remainingKrw ?? result?.residualCashKrw ?? 0;
  const fees = sized?.feesKrw ?? 0;
  const palette = colors.length ? colors : DEFAULT_COLORS;
  const buys = result
    ? result.rows
        .filter((row) => row.allocationKrw > 0)
        .map((row, index) => ({
          key: row.allocationKey ?? row.accountCode + ":" + index,
          name: instrumentLabel(row),
          account: row.accountName,
          amount: sized ? sizedByKey.get(row.allocationKey)?.principalKrw ?? 0 : row.allocationKrw,
          color: palette[index % palette.length],
        })).filter(row => row.amount > 0)
    : [];
  const segments = [...buys, ...(fees > 0 ? [{key:"fees",name:"예상 비용",amount:fees,account:"",color:"#aa9786"}] : []), ...(cash > 0 ? [{
      key: "residual",
      name: "남는 현금",
      amount: cash,
      account: "",
      color: "#dedfd8",
    }] : [])];
  const leadingBuys = [...buys].sort((left, right) => right.amount - left.amount).slice(0, 2);
  const pendingLabel = pendingAmount != null ? eventNumber(pendingAmount) + "원 배분을 계산 중이에요." : null;
  if (!result) return <p className={home.pending} role="status" data-contribution-state={dirty ? 'edited' : read?.state ?? view.domain?.state}>
    {pendingLabel ?? (dirty ? '변경한 금액으로 계산해 주세요' : read?.state === 'blocked' || read?.state === 'unavailable'
      ? <RecoveryTitle reasons={read.blockers} kind={read.state === 'unavailable' ? 'retry' : undefined} />
      : read?.message ?? '계산할 금액을 확인해 주세요')}
  </p>;
  return (
    <div
      className={home.surface}
      data-contribution-state={pendingLabel ? "loading" : "ready"}
    >
      <div
        className={home.allocation}
        role="img"
        aria-label={
          "총 배분 재원 " +
          eventNumber(budget) +
          " KRW. " +
          (segments.length
            ? segments
                .map((row) => [row.name, row.account, eventNumber(row.amount) + " KRW"].filter(Boolean).join(" · "))
                .join(". ")
            : "매수 배분과 남는 현금 0 KRW")
        }
      >
        {segments.map((row, index) => (
          <span
            key={result.cashAmountKrw + ":" + row.key}
            data-funding-amount={row.amount}
            style={{
              width: (budget > 0 ? (row.amount / budget) * 100 : 0) + "%",
              backgroundColor: row.color,
              animationDelay: `${index * 40}ms`,
            }}
            title={[row.name, row.account, eventNumber(row.amount) + " KRW"].filter(Boolean).join(" · ")}
          />
        ))}
      </div>
      {leadingBuys.length > 0 && (
        <ul className={home.leadingBuys} aria-label="주요 추가 매수">
          {leadingBuys.map(row => <li key={row.key}>
            <span className={home.buyMark} style={{ backgroundColor: row.color }} aria-hidden />
            <span className={home.buyName}>{row.name}<small>{row.account}</small></span>
            <strong>{eventNumber(row.amount)}<small>원</small></strong>
          </li>)}
        </ul>
      )}
      <dl className={home.summary}>
        <div>
          <dt>{sized ? "예상 매수 원금" : "목표 매수 배분"}</dt>
          <dd>
            {eventNumber(sized?.principalKrw ?? result.totalAllocatedKrw)}
            <small>원</small>
          </dd>
        </div>
        <div>
          <dt>{sized ? "주문 예산 잔액" : "남는 현금"}</dt>
          <dd>
            {eventNumber(cash)}
            <small>원</small>
          </dd>
        </div>
      </dl>
      {sized && read?.orderBasis?.unavailable.length ? <p className={home.calculating}>일부 종목의 주문 단가·단위 확인이 필요해요.</p> : null}
      {pendingLabel && <p className={home.calculating} role="status">{pendingLabel} <span>현재 {eventNumber(result.cashAmountKrw)}원 기준</span></p>}
    </div>
  );
}
