"use client";
import { Field, Fieldset, Input, Select, Status } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { Decimal } from "@/lib/money";
import { importIssue, photoImportMessage, photoOrderingEntries, type ReviewedPhotoTrade, type TradeImportContext } from "@/lib/trade-photo-import";
import styles from "./trade-photo-import.module.css";

export function TradePhotoReview({ row, queue, context, disabled, change }: {
  row: ReviewedPhotoTrade; queue: ReviewedPhotoTrade[]; context: TradeImportContext; disabled: boolean; change: (patch: Partial<ReviewedPhotoTrade>) => void;
}) {
  const { t } = useI18n();
  const account = context.accounts.find(a => a.id === row.accountId);
  const ownIndex = queue.findIndex(r => r.key === row.key);
  const issue = importIssue(row, context, queue);
  let total = "—";
  try { total = Decimal.from(row.quantity).mul(row.price).toExactString(); } catch { /* Unverified input. */ }
  const dayEntries = photoOrderingEntries(row, context.entries);
  const preceding = context.entries.filter(e => e.accountId === row.accountId && e.date < row.date).at(-1);
  const earlier = queue.slice(0, ownIndex).filter(r => r.status !== "excluded" && r.accountId === row.accountId && r.date === row.date);
  return <Fieldset className={styles.editor} disabled={disabled}>
    <legend>{t("체결 정보 확인", "Review the fill")}</legend>
    <p className={styles.hint}>{t("사진 속 종목", "From the photo")} · {row.label}</p>
    <Field>{t("기록할 계좌", "Account")}<Select value={row.accountId} onChange={e => change({ accountId: e.target.value, assetId: "", afterEventId: "" })}><option value="">{t("계좌 선택", "Choose an account")}</option>{context.accounts.filter(a => a.active !== false).map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</Select></Field>
    <Field>{t("종목", "Holding")}<Select value={row.assetId} onChange={e => change({ assetId: e.target.value })}><option value="">{t("사진 속 종목 선택", "Choose the pictured holding")}</option>{account?.assets.map(a => <option value={a.id} key={a.id}>{a.name} · {a.ticker} · {a.currency}</option>)}</Select></Field>
    <div className={styles.pair}>
      <Field>{t("거래 종류", "Trade type")}<Select value={row.side} onChange={e => change({ side: e.target.value as "buy" | "sell" })}><option value="buy">{t("매수", "Buy")}</option><option value="sell">{t("매도", "Sell")}</option></Select></Field>
      <Field>{t("체결일 · 한국시간", "Fill date · Korea time")}<Input type="date" value={row.date} onChange={e => change({ date: e.target.value, afterEventId: "" })} /></Field>
    </div>
    <p className={styles.hint}>{t("주문일과 다르면 체결일로 바꿔 주세요. 시각은 미상으로 기록해요.", "Use the fill date if it differs from the order date. Execution time is recorded as unknown.")}</p>
    <div className={`${styles.pair} ${styles.executionFields}`}>
      <Field>{t("체결 수량", "Executed quantity")}<Input inputMode="decimal" maxLength={24} value={row.quantity} onChange={e => change({ quantity: e.target.value })} /></Field>
      <Field>{t("체결 단가", "Execution price")}<Input inputMode="decimal" maxLength={30} value={row.price} onChange={e => change({ price: e.target.value })} /></Field>
    </div>
    <Field>{t("단가 통화", "Price currency")}<Select value={row.currency} onChange={e => change({ currency: e.target.value as ReviewedPhotoTrade["currency"] })}><option value="">{t("확인 필요", "Confirm currency")}</option><option value="USD">USD · {t("달러", "US dollar")}</option><option value="KRW">KRW · {t("원", "Korean won")}</option></Select></Field>
    {row.priceSource === "derived" && <Status as="p">{t("체결금액 ÷ 수량으로 계산한 단가예요. 주문 가격과 다를 수 있어요.", "Price is derived from filled amount ÷ quantity. It may differ from the order price.")}</Status>}
    <div className={styles.total}><span>{t("기록할 체결금액", "Consideration to record")}</span><strong>{total} <small>{row.currency}</small></strong><span>{t("수량 × 단가 · 현금 정산 제외", "Quantity × price · no cash settlement")}</span></div>
    {row.gross && <details className={styles.help}><summary>{t("사진 속 금액", "Amount in photo")} · {row.gross} {row.currency}</summary><p>{t("표시 반올림으로 차이가 날 수 있어요. 확인한 수량 × 단가를 기록합니다.", "Display rounding can cause a difference. We record the verified quantity × price.")}</p></details>}
    {(dayEntries.length > 0 || earlier.length > 0) && <Field>같은 날, 이 거래 직전의 기록<Select value={row.afterEventId} onChange={e => change({ afterEventId: e.target.value })}><option value="">거래 순서 확인</option>{preceding && <option value={preceding.id}>이 날짜의 첫 거래</option>}{dayEntries.map((e, i) => <option value={e.id} key={e.id}>{i + 1}. {e.type === "buy" ? "매수" : e.type === "sell" ? "매도" : "기존 기록"} · {account?.assets.find(a => a.id === e.assetId)?.ticker ?? ""} {e.quantity ?? ""} · {e.at}</option>)}{earlier.map(r => <option key={r.key} value={`queue:${r.key}`}>이번 목록 · {r.label} {r.side === "buy" ? "매수" : "매도"} {r.quantity}주 다음</option>)}</Select></Field>}
    <Field className={styles.confirm}><Input type="checkbox" checked={row.verified} onChange={e => change({ verified: e.target.checked })} />{t("종목·체결일·수량·단가를 확인했어요. 시작 잔고에 포함되지 않은 거래예요.", "I verified the holding, fill date, quantity and price. This trade is not included in the opening balance.")}</Field>
    {issue && issue !== "review_required" && <Status as="p" tone="warning">{photoImportMessage(issue)}</Status>}
  </Fieldset>;
}
