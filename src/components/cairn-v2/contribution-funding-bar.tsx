"use client";

import { HOME_ALLOCATION_COLORS } from "@/components/portfolio/allocation-colors";
import { useI18n } from "@/components/i18n/locale-provider";
import type { ContributionOrderBasis } from "@/lib/cairn-v2/contribution-order-plan";
import type { ReadyContribution } from "@/lib/cairn-v2/planning-contract";
import { instrumentLabel } from "@/lib/instrument-display";
import { useContributionOrderPlan } from "./contribution-order-context";
import { formatBuyQuantity, formatOrderUnitPrice } from "./contribution-order-display";
import styles from "./contribution-funding-bar.module.css";

const formatAmount = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });

export function ContributionFundingBar({ result, basis, showLeadingBuys = false, presentation = "orders" }: {
  result: ReadyContribution;
  basis?: ContributionOrderBasis;
  showLeadingBuys?: boolean;
  presentation?: "orders" | "strategy";
}) {
  const { t } = useI18n();
  const { projection } = useContributionOrderPlan(basis);
  const sized = presentation === "orders" && projection?.result && projection.result.status !== "unavailable" ? projection.result : null;
  const orderBudget = basis && sized ? basis.budgetKrw : null;
  const total = sized ? result.cashAmountKrw : result.totalAvailableFundsKrw;
  const won = (value: number) => t(`${formatAmount(value)}원`, `₩${formatAmount(value)}`);
  const principal = sized?.principalKrw ?? result.totalAllocatedKrw;
  const remainder = sized?.remainingKrw ?? result.residualCashKrw;
  const sections = [
    { key: "buy", label: sized ? t("예상 매수 원금", "Estimated purchases") : t("목표 매수 배분", "Target buys"), amount: principal },
    { key: "fees", label: t("예상 비용", "Estimated fees"), amount: sized?.feesKrw ?? 0 },
    { key: "remaining", label: sized ? t("주문 후 잔액", "Unspent order budget") : t("남는 현금", "Remaining cash"), amount: remainder },
    { key: "reserve", label: t("전략 유보금", "Held back by strategy"), amount: orderBudget === null ? 0 : result.cashAmountKrw - orderBudget },
  ];
  const ordersByKey = new Map(sized?.orders.map(row => [row.key, row]));
  const basisByKey = new Map(basis?.rows.map(row => [row.key, row]));
  const candidates = result.rows.filter(row => row.allocationKrw > 0).map(row => {
    const order = ordersByKey.get(row.allocationKey);
    const terms = basisByKey.get(row.allocationKey);
    return { key: row.allocationKey, name: instrumentLabel(row), account: row.accountName,
      target: row.allocationKrw, buy: sized ? order?.principalKrw ?? 0 : row.allocationKrw,
      order, terms };
  }).sort((left, right) => right.buy - left.buy || right.target - left.target)
    .map((row, index) => ({ ...row, color: HOME_ALLOCATION_COLORS[index % HOME_ALLOCATION_COLORS.length] }));
  const purchases = candidates.filter(row => row.buy > 0);
  const leading = showLeadingBuys ? candidates.slice(0, 2) : [];
  const segments = [
    ...purchases.map(row => ({ key: row.key, label: row.name, amount: row.buy, color: row.color, tone: "buy" })),
    ...sections.slice(1).filter(row => row.amount > 0).map(row => ({ ...row, tone: row.key, color: undefined })),
  ];
  const title = sized || !result.totalTrimProceedsKrw ? t("새 투자금 배분", "New money allocation") : t("예상 매도대금 포함 배분", "Allocation including projected sales");
  return <figure className={styles.figure}>
    <figcaption><span>{title}</span><strong>{won(total)}</strong></figcaption>
    <div className={styles.bar} role="img" aria-label={[title, won(total), ...segments.map(row => row.label + " " + won(row.amount))].join(" · ")}>
      {segments.map(row => <span key={row.key} data-tone={row.tone} data-funding-amount={row.amount}
        style={{ width: (total > 0 ? row.amount / total * 100 : 0) + "%", backgroundColor: row.color }} />)}
    </div>
    <dl className={styles.legend}>
      {sections.filter(row => row.amount > 0 || row.key === "buy").map(row => <div key={row.key} data-tone={row.key}>
        <dt>{row.label}</dt><dd>{won(row.amount)}</dd>
      </div>)}
    </dl>
    {presentation === "orders" && basis && !sized && <p className={styles.note}>{t("예상 수량을 계산할 수 없어 목표 배분을 표시해요.", "Showing target allocations while estimated orders are unavailable.")}</p>}
    {showLeadingBuys && orderBudget !== null && <p className={styles.orderBudget}><span>{t("주문 예산", "Order budget")}</span><strong>{won(orderBudget)}</strong></p>}
    {leading.length > 0 && <ul className={styles.leading} aria-label={t("주요 추가 매수", "Leading buy allocations")}>
      {leading.map(row => <li key={row.key}>
        <span className={styles.dot} data-empty={row.buy === 0 || undefined} style={{ color: row.color }} aria-hidden="true" />
        <div><strong>{row.name}</strong><small>{row.account}{row.order && row.terms && " · " + formatOrderUnitPrice(row.terms, t)}</small></div>
        <div className={styles.amount}>
          <strong>{sized && row.buy === 0 ? (row.terms ? t("주문 없음", "No order") : t("단가 확인 필요", "Price needed")) : won(row.buy)}</strong>
          <small>{row.order && row.terms ? formatBuyQuantity(row.order, row.terms, t) :
            sized && row.target !== row.buy ? t(`목표 ${won(row.target)}`, `Target ${won(row.target)}`) :
            t("목표 배분", "Target allocation")}</small>
        </div>
      </li>)}
    </ul>}
  </figure>;
}
