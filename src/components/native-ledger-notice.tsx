import Link from "next/link";
import { T } from "@/components/i18n/localized-text";
import { nativeLedgerHref } from "@/lib/native-ledger-compatibility";

export function NativeLedgerNotice({ accountId, assetId, action }: { accountId?: string; assetId?: string; action?: "buy" | "sell" | "cost_basis" }) {
  return <div className="space-y-3 text-sm leading-6" data-native-ledger-notice>
    <p><T ko="이 계좌의 수량·현금·매입원가는 거래 기록에 맞춰 함께 관리됩니다. 실제 거래 금액과 날짜로 매수·매도를 기록하거나, 알려진 매입원가를 보완해 주세요." en="Quantity, cash and acquisition cost are managed together for this account. Record buys and sells using their actual amounts and dates, or add known acquisition costs." /></p>
    <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={nativeLedgerHref(accountId, assetId, action)}><T ko="거래·현금 원장에서 계속하기" en="Continue in holdings & cash" /></Link>
  </div>;
}
