"use client";
import { Button, Field, Fieldset, Input, Select, Status } from "@/components/cairn-ui";
import { Decimal } from "@/lib/money";
import { importIssue, photoImportMessage, photoOrderingEntries, type ReviewedPhotoTrade, type TradeImportContext } from "@/lib/trade-photo-import";
import styles from "./trade-photo-import.module.css";

export function TradePhotoReview({ row, queue, context, disabled, change }: {
  row: ReviewedPhotoTrade; queue: ReviewedPhotoTrade[]; context: TradeImportContext; disabled: boolean; change: (patch: Partial<ReviewedPhotoTrade>) => void;
}) {
  const account = context.accounts.find(a => a.id === row.accountId);
  const ownIndex = queue.findIndex(r => r.key === row.key);
  const issue = importIssue(row, context, queue);
  let total = "—";
  try { total = Decimal.from(row.quantity).mul(row.price).toExactString(); } catch { /* Unverified input. */ }
  const dayEntries = photoOrderingEntries(row, context.entries);
  const preceding = context.entries.filter(e => e.accountId === row.accountId && e.date < row.date).at(-1);
  const earlier = queue.slice(0, ownIndex).filter(r => r.status !== "excluded" && r.accountId === row.accountId && r.date === row.date);
  return <Fieldset className={styles.editor} disabled={disabled}>
    <legend>사진과 대조하기</legend>
    <p className={styles.hint}>사진에서 읽은 종목 · {row.label}</p>
    <Field>기록할 계좌<Select value={row.accountId} onChange={e => change({ accountId: e.target.value, assetId: "", afterEventId: "" })}><option value="">계좌 선택</option>{context.accounts.filter(a => a.active !== false).map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</Select></Field>
    <Field>종목<Select value={row.assetId} onChange={e => change({ assetId: e.target.value })}><option value="">사진 속 종목 선택</option>{account?.assets.map(a => <option value={a.id} key={a.id}>{a.name} · {a.ticker} · {a.currency}</option>)}</Select></Field>
    <div className={styles.pair}>
      <Field>거래 종류<Select value={row.side} onChange={e => change({ side: e.target.value as "buy" | "sell" })}><option value="buy">매수</option><option value="sell">매도</option></Select></Field>
      <Field>실제 체결일 · 한국시간<Input type="date" value={row.date} onChange={e => change({ date: e.target.value, afterEventId: "" })} /></Field>
    </div>
    <p className={styles.hint}>사진의 주문일은 체결일과 다를 수 있어요. 실제 체결일로 고쳐 주세요. 시각은 미상으로 기록합니다.</p>
    <div className={styles.pair}>
      <Field>체결 수량<Input inputMode="decimal" maxLength={24} value={row.quantity} onChange={e => change({ quantity: e.target.value })} /></Field>
      <Field>1주당 체결 단가<Input inputMode="decimal" maxLength={30} value={row.price} onChange={e => change({ price: e.target.value })} /></Field>
    </div>
    <Field>단가 통화<Select value={row.currency} onChange={e => change({ currency: e.target.value as ReviewedPhotoTrade["currency"] })}><option value="">확인 필요</option><option value="USD">USD · 달러</option><option value="KRW">KRW · 원</option></Select></Field>
    {row.priceSource === "derived" && <Status as="p">목록의 체결금액 ÷ 체결수량으로 단가를 계산했어요. 주문 가격과는 다를 수 있습니다.</Status>}
    <div className={styles.total}><span>기록할 체결금액</span><strong>{total} <small>{row.currency}</small></strong></div>
    {row.gross && <p className={styles.hint}>사진에 표시된 체결금액 {row.gross} {row.currency} · 표시 반올림으로 차이가 날 수 있어요. 기록에는 확인한 수량 × 단가를 사용합니다.</p>}
    {(dayEntries.length > 0 || earlier.length > 0) && <Field>같은 날, 이 거래 직전의 기록<Select value={row.afterEventId} onChange={e => change({ afterEventId: e.target.value })}><option value="">거래 순서 확인</option>{preceding && <option value={preceding.id}>이 날짜의 첫 거래</option>}{dayEntries.map((e, i) => <option value={e.id} key={e.id}>{i + 1}. {e.type === "buy" ? "매수" : e.type === "sell" ? "매도" : "기존 기록"} · {account?.assets.find(a => a.id === e.assetId)?.ticker ?? ""} {e.quantity ?? ""} · {e.at}</option>)}{earlier.map(r => <option key={r.key} value={`queue:${r.key}`}>이번 목록 · {r.label} {r.side === "buy" ? "매수" : "매도"} {r.quantity}주 다음</option>)}</Select></Field>}
    <Field className={styles.confirm}><Input type="checkbox" checked={row.verified} onChange={e => change({ verified: e.target.checked })} />종목·체결일·수량·단가를 확인했고, 시작 잔고에 포함되지 않은 누락 거래입니다.</Field>
    {issue && issue !== "review_required" && <Status as="p" tone="warning">{photoImportMessage(issue)}</Status>}
    <Button type="button" variant="ghost" onClick={() => change({ status: "excluded", verified: false })}>이 거래 제외</Button>
  </Fieldset>;
}
