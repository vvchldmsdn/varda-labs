import { T } from "@/components/i18n/localized-text";
import { formatBrokerEvidenceMoney, formatBrokerEvidenceUnitPrice, type BrokerRecoveryDisplay } from "@/lib/broker-recovery-display";

export function BrokerEvidenceDetails({ evidence }: { evidence: BrokerRecoveryDisplay }) {
  return <details className="mt-1 text-xs font-normal text-[var(--muted)]">
    <summary className="cursor-pointer"><T ko="거래·결제 내역" en="Trade and settlement" /></summary>
    <dl className="mt-2 space-y-1">
      {evidence.orderUnitPrice ? <div><dt className="inline"><T ko="주문 단가" en="Order unit price" /> </dt><dd className="inline tabular-nums">{formatBrokerEvidenceUnitPrice(evidence.orderUnitPrice)}</dd></div> : null}
      {evidence.executionGross ? <div><dt className="inline"><T ko="거래금액" en="Trade amount" /> </dt><dd className="inline tabular-nums">{formatBrokerEvidenceMoney(evidence.executionGross)}</dd></div> : null}
      {evidence.originalDisplay ? <div><dt className="inline"><T ko="주문 표시액" en="Order display amount" /> </dt><dd className="inline tabular-nums">{formatBrokerEvidenceMoney(evidence.originalDisplay)}</dd></div> : null}
      {evidence.cashSettlement ? <div><dt className="inline"><T ko="실제 결제액" en="Cash settlement" /> </dt><dd className="inline tabular-nums">{formatBrokerEvidenceMoney(evidence.cashSettlement)} · {evidence.cashSettlement.date}</dd></div> : null}
    </dl>
    <p className="mt-1"><T ko="수수료·세금 구분 미확인" en="Fees and taxes not itemized" /></p>
  </details>;
}
