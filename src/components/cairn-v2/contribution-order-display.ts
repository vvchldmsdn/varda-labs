import type { SizedContributionOrder } from "@/lib/additional-contribution-order-sizing";
import type { ContributionOrderBasis } from "@/lib/cairn-v2/contribution-order-plan";
import { moneyFromMinor } from "@/lib/money";

type Quote = ContributionOrderBasis["rows"][number];
type Translate = (ko: string, en: string) => string;

export function formatOrderUnitPrice(quote: Quote, t: Translate): string {
  const price = quote.price.toLocaleString("en-US", {
    minimumFractionDigits: quote.currency === "USD" ? 2 : 0,
    maximumFractionDigits: 8,
  });
  const money = quote.currency === "USD" ? `$${price}` : t(`${price}원`, `₩${price}`);
  return quote.unit === "gram" ? t(`1g당 ${money}`, `${money}/g`) : t(`1주당 ${money}`, `${money}/share`);
}

export function formatBuyQuantity(order: SizedContributionOrder, quote: Quote, t: Translate): string {
  if (order.quantity !== null || order.principalMinor === 0) {
    const quantity = order.quantity ?? "0";
    if (quote.unit === "gram") return `${quantity}g`;
    return t(`${quantity}주`, quantity === "1" ? "1 share" : `${quantity} shares`);
  }

  // An amount order settles in native currency. Its share equivalent can
  // change at execution, even when the order's monetary amount is fixed.
  const shares = moneyFromMinor(order.principalMinor, order.currency) / quote.price;
  const estimate = shares.toLocaleString("en-US", { maximumSignificantDigits: 8 });
  return t(`금액 주문 · 약 ${estimate}주`, `Amount order · ≈${estimate} shares`);
}
