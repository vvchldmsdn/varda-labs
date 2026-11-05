"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { Check, ImagePlus } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/cairn-ui/forms";
import { parseTradePhoto, type TradePhotoCandidate } from "@/lib/trade-photo";
import { photoFillNeedsTime, photoFillReview, preparePhotoFill, type ExistingPhotoFillTrade, type TradePhotoFillApplication, type TradePhotoFillHolding, type TradePhotoFillIssue, type TradePhotoFillReview } from "@/lib/trade-photo-fill";
import styles from "./trade-photo-fill.module.css";

type Translate = (ko: string, en: string) => string;
type PhotoState = {
  open: boolean; progress: number | null; rows: TradePhotoCandidate[]; selected: string;
  review: TradePhotoFillReview | null; url: string; error: string; excluded: number; attempted: boolean;
};
const emptyPhoto = (): PhotoState => ({ open: false, progress: null, rows: [], selected: "", review: null, url: "", error: "", excluded: 0, attempted: false });
export type TradePhotoFillProps = {
  accountId: string; holdings: readonly TradePhotoFillHolding[]; selectedAssetId?: string;
  side: "buy" | "sell"; disabled?: boolean; serverNow?: string; readServerNow?: () => string;
  existingTrades?: readonly ExistingPhotoFillTrade[];
  onApply: (value: TradePhotoFillApplication) => void; onOpenChange?: (open: boolean) => void; t?: Translate;
};

function issueMessage(reason: TradePhotoFillIssue["reason"], t: Translate) {
  switch (reason) {
    case "holding": return t("사진의 종목을 이 계좌에서 선택해 주세요.", "Choose the pictured holding in this account.");
    case "side": return t("매수인지 매도인지 확인해 주세요.", "Confirm whether this is a buy or sell.");
    case "date": return t("실제로 체결된 날짜를 입력해 주세요.", "Enter the actual execution date.");
    case "time": return t("오늘 거래는 실제 체결 시각을 한국시간으로 입력해 주세요.", "Enter today's actual execution time in Korean time.");
    case "future": return t("아직 지나지 않은 시각이에요. 실제 체결 날짜와 시각을 확인해 주세요.", "This time is in the future. Check the execution date and time.");
    case "quantity": return t("체결 수량을 입력해 주세요. 소수 여섯째 자리까지 입력할 수 있어요.", "Enter a filled quantity, up to six decimal places.");
    case "amount": return t("0보다 큰 체결 가격 또는 총액을 입력해 주세요.", "Enter a positive execution price or total.");
    case "currency": return t("체결 가격의 통화를 선택해 주세요.", "Choose the currency of the execution amount.");
    case "currency_mismatch": return t("선택한 종목과 가격의 통화가 달라요. 종목과 체결 가격을 확인해 주세요.", "This currency differs from the holding. Check the holding and execution price.");
    case "duplicate": return t("같은 내용의 기록이 있어요. 중복인지 기존 기록을 확인해 주세요. 별개의 체결이라면 직접 입력할 수 있어요.", "A matching record exists. Check for a duplicate; use manual entry for a separate execution.");
    default: return t("체결 정보와 기존 잔고 포함 여부를 확인해 주세요.", "Confirm the execution details and whether it is already included in your balance.");
  }
}

/** Local OCR only: confirmation fills the caller's editable fields, never its writer.
 * The caller keys this component by session/account identity and locks its save
 * action while onOpenChange is true. No photo or OCR text enters draft storage. */
export function TradePhotoFill({ accountId, holdings, selectedAssetId, side, disabled = false, existingTrades = [], serverNow, readServerNow, onApply, onOpenChange, t = ko => ko }: TradePhotoFillProps) {
  const [photo, setPhoto] = useState<PhotoState>(emptyPhoto), [showTime, setShowTime] = useState(false), [applied, setApplied] = useState(false);
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null), reviewArea = useRef<HTMLDivElement>(null);
  const task = useRef<AbortController | null>(null), generation = useRef(0), photoUrl = useRef(""), mounted = useRef(true), opening = useRef(onOpenChange);
  const id = useId();
  useEffect(() => { opening.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; task.current?.abort();
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    opening.current?.(false);
  }; }, []);
  function discardPhoto() {
    generation.current++; task.current?.abort(); task.current = null;
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current); photoUrl.current = "";
  }
  function close() {
    discardPhoto(); setPhoto(emptyPhoto()); setShowTime(false); opening.current?.(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  async function readPhoto(file: File) {
    if (disabled || !accountId) return;
    discardPhoto(); const token = generation.current, controller = new AbortController(); task.current = controller;
    setApplied(false); setShowTime(false); setPhoto({ ...emptyPhoto(), open: true, progress: 0 }); opening.current?.(true);
    const current = () => mounted.current && token === generation.current && !controller.signal.aborted;
    try {
      const { readBrokeragePhotoText } = await import("@/lib/balance-photo-reader");
      if (!current()) return;
      const page = await readBrokeragePhotoText(file, controller.signal, value => {
        if (current()) setPhoto(previous => ({ ...previous, progress: Math.max(previous.progress ?? 0, Math.min(100, Math.max(0, value))) }));
      }, { tradeNumbers: true });
      if (!current()) return;
      const parsed = parseTradePhoto(page.lines, page.width, page.height);
      if (!parsed.rows.length) {
        setPhoto(previous => ({ ...previous, progress: null, error: t("체결 정보를 읽지 못했어요. 체결 수량과 단가 또는 체결금액이 보이는 상세 사진을 선택하거나 직접 입력해 주세요.", "No execution details were read. Choose fill details showing quantity and price or execution total, or enter them manually.") }));
        return;
      }
      const url = URL.createObjectURL(file); photoUrl.current = url;
      setPhoto({ open: true, progress: null, rows: parsed.rows, selected: parsed.rows.length === 1 ? "0" : "", review: parsed.rows.length === 1 ? photoFillReview(parsed.rows[0], holdings) : null, url, error: "", excluded: parsed.excluded, attempted: false });
      requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) {
      if (!current()) return;
      const reason = cause instanceof Error ? cause.message : "";
      setPhoto(previous => ({ ...previous, progress: null, error: reason === "format"
        ? t("JPG·PNG·WebP 사진을 12MB 이하로 선택해 주세요.", "Choose a JPG, PNG or WebP photo up to 12MB.")
        : reason === "dimensions" ? t("사진이 너무 작거나 커요. 읽기 쉬운 체결 화면 한 장을 선택해 주세요.", "Choose one legible execution screen; this image is too small or large.")
          : t("사진을 읽지 못했어요. 연결을 확인하고 다시 선택하거나 직접 입력해 주세요.", "The photo could not be read. Check your connection and retry, or enter manually.") }));
    } finally { if (current()) task.current = null; }
  }
  function change(patch: Partial<TradePhotoFillReview>) {
    setPhoto(previous => ({ ...previous, review: previous.review ? { ...previous.review, verified: false, ...patch } : null, error: "" }));
  }
  const now = readServerNow?.() ?? serverNow;
  const result = photo.review ? preparePhotoFill(photo.review, holdings, existingTrades, now) : null;
  const issue = result && !result.ok ? result.issue : null;
  const visibleIssue = issue && (photo.attempted || ["duplicate", "future", "time"].includes(issue.reason)) ? issue : null;
  const message = visibleIssue ? issueMessage(visibleIssue.reason, t) : "";
  const fieldError = (field: TradePhotoFillIssue["field"]) => visibleIssue?.field === field ? <span id={`${id}-${field}-error`}>{message}</span> : undefined;
  const fieldProps = (field: TradePhotoFillIssue["field"]) => ({ "aria-invalid": visibleIssue?.field === field || undefined, "aria-describedby": visibleIssue?.field === field ? `${id}-${field}-error` : undefined });
  function apply() {
    if (disabled || photo.progress !== null || !photo.review) return;
    const checked = preparePhotoFill(photo.review, holdings, existingTrades, readServerNow?.() ?? serverNow);
    if (!checked.ok) {
      setPhoto(previous => ({ ...previous, attempted: true }));
      requestAnimationFrame(() => reviewArea.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return;
    }
    close(); setApplied(true); onApply(checked.value);
  }
  const row = photo.review, busy = photo.progress !== null;
  return <div className={styles.entry} data-trade-photo-fill>
    <Button ref={trigger} className={styles.trigger} type="button" size="sm" variant="ghost" disabled={disabled || busy || !accountId} onClick={() => input.current?.click()}><ImagePlus size={17} aria-hidden="true" />{t("사진에서 입력", "Fill from a photo")}</Button>
    <Input hidden ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label={t("체결 내역 사진", "Execution photo")} disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readPhoto(file); }} />
    {!photo.open && applied && <p role="status" className={styles.success}><Check size={16} aria-hidden="true" />{t("입력칸에 채웠어요. 확인 후 기록해 주세요.", "Fields filled. Review them before recording.")}</p>}
    {photo.open && <div ref={reviewArea} className={styles.review} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <h3 ref={heading} tabIndex={-1}>{busy ? t("체결 내역을 읽고 있어요", "Reading execution details") : t("체결 내역을 확인해 주세요", "Review the execution")}</h3>
      <p className={styles.note}>{t("사진은 이 기기에서만 읽어요. 확인한 내용만 입력칸에 채워요.", "Photos are read on this device. Only confirmed details fill your fields.")}</p>
      {busy && <div className={styles.progress} role="status"><progress max={100} value={photo.progress ?? 0} aria-label={t("사진 인식 진행", "Photo recognition progress")} /><span>{photo.progress}%</span></div>}
      {photo.error && <p className={styles.issue} role="alert">{photo.error}</p>}
      {photo.rows.length > 1 && <Field label={t("입력할 체결 내역", "Execution to enter")}><Select value={photo.selected} disabled={disabled} onChange={event => { const selected = event.target.value; setPhoto(previous => ({ ...previous, selected, review: selected !== "" ? photoFillReview(previous.rows[Number(selected)], holdings) : null, attempted: false })); setShowTime(false); }}><option value="">{t("사진에서 한 건을 골라 주세요", "Choose one execution from the photo")}</option>{photo.rows.map((candidate, index) => <option value={index} key={index}>{candidate.label} · {candidate.side === "buy" ? t("매수", "Buy") : t("매도", "Sell")} · {candidate.quantity || "?"} · {candidate.date || t("날짜 확인", "Check date")}</option>)}</Select></Field>}
      {row && <>
        <p className={styles.note}>{row.label}{photo.excluded > 0 ? t(` · 미체결·취소 ${photo.excluded}건 제외`, ` · ${photo.excluded} unfilled/cancelled orders excluded`) : ""}</p>
        <Field label={t("종목", "Holding")} error={fieldError("assetId")}><Select value={row.assetId} disabled={disabled} {...fieldProps("assetId")} onChange={event => change({ assetId: event.target.value })}><option value="">{t("이 계좌의 종목 선택", "Choose a holding in this account")}</option>{holdings.map(holding => <option key={holding.id} value={holding.id}>{holding.name}{holding.ticker && holding.ticker !== holding.name ? ` · ${holding.ticker}` : ""}</option>)}</Select></Field>
        {selectedAssetId && row.assetId && selectedAssetId !== row.assetId && <p className={styles.note}>{t("사진의 종목으로 바뀌어요. 맞는 종목인지 확인해 주세요.", "This changes the selected holding. Confirm the pictured instrument.")}</p>}
        <div className={styles.pair}>
          <Field label={t("거래 종류", "Trade side")} error={fieldError("side")}><Select value={row.side} disabled={disabled} {...fieldProps("side")} onChange={event => change({ side: event.target.value as "buy" | "sell" })}><option value="buy">{t("매수", "Buy")}</option><option value="sell">{t("매도", "Sell")}</option></Select></Field>
          <Field label={t("체결일", "Execution date")} error={fieldError("date")}><Input type="date" value={row.date} disabled={disabled} {...fieldProps("date")} onChange={event => change({ date: event.target.value, time: "" })} /></Field>
        </div>
        <p className={styles.note}>{t("사진에 주문일이 표시될 수 있어요. 실제 체결일을 확인해 주세요.", "The photo may show an order date. Confirm the actual execution date.")}{side !== row.side ? t(" 매수·매도 종류도 달라요.", " The trade side also differs.") : ""}</p>
        {showTime || row.time || photoFillNeedsTime(row.date, now) ? <Field label={t("체결 시각 · 한국시간", "Execution time · Korean time")} error={fieldError("time")}><Input type="time" value={row.time} disabled={disabled} {...fieldProps("time")} onChange={event => change({ time: event.target.value })} /></Field> : <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setShowTime(true)}>{t("체결 시각도 입력", "Add execution time")}</Button>}
        <Field label={t("체결 수량", "Filled quantity")} error={fieldError("quantity")} className={styles.amount}><Input inputMode="decimal" value={row.quantity} disabled={disabled} {...fieldProps("quantity")} onChange={event => change({ quantity: event.target.value })} /></Field>
        <div className={styles.mode} aria-label={t("체결 가격 입력 방식", "Execution amount mode")}><Button type="button" size="sm" variant="selection" aria-pressed={row.mode === "execution"} disabled={disabled} onClick={() => change({ mode: "execution" })}>{t("1주 가격", "Unit price")}</Button><Button type="button" size="sm" variant="selection" aria-pressed={row.mode === "execution_total"} disabled={disabled} onClick={() => change({ mode: "execution_total" })}>{t("체결 총액", "Execution total")}</Button></div>
        <div className={styles.pair}>
          {row.mode === "execution" ? <Field label={t("1주 체결 가격", "Execution unit price")} error={fieldError("price")}><Input inputMode="decimal" value={row.price} disabled={disabled} {...fieldProps("price")} onChange={event => change({ price: event.target.value })} /></Field> : <Field label={t("체결 총액", "Execution total")} error={fieldError("executionTotal")}><Input inputMode="decimal" value={row.executionTotal} disabled={disabled} {...fieldProps("executionTotal")} onChange={event => change({ executionTotal: event.target.value })} /></Field>}
          <Field label={t("가격 통화", "Price currency")} error={fieldError("currency")}><Select value={row.currency} disabled={disabled} {...fieldProps("currency")} onChange={event => change({ currency: event.target.value as TradePhotoFillReview["currency"] })}><option value="">{t("통화 선택", "Choose currency")}</option><option value="KRW">KRW</option><option value="USD">USD</option></Select></Field>
        </div>
        <Field className={styles.confirm} error={fieldError("verified")}><Input type="checkbox" checked={row.verified} disabled={disabled} {...fieldProps("verified")} onChange={event => change({ verified: event.target.checked })} /><span>{t("체결 정보를 확인했으며, 이미 등록한 잔고에 포함된 거래가 아니에요.", "I checked the execution; it is not already included in my registered balance.")}</span></Field>
      </>}
      {photo.url && <details className={styles.photo}><summary>{t("선택한 사진 보기", "View selected photo")}</summary><Image src={photo.url} alt={t("확인 중인 체결 내역 사진", "Execution photo under review")} width={600} height={900} unoptimized /></details>}
      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={close}>{t("취소하고 직접 입력", "Cancel and enter manually")}</Button>
        {row ? <Button type="button" variant="primary" disabled={disabled || busy} onClick={apply}>{t("입력칸에 채우기", "Fill fields")}</Button> : !busy && <Button type="button" disabled={disabled} onClick={() => input.current?.click()}>{t("다른 사진 선택", "Choose another photo")}</Button>}
      </div>
    </div>}
  </div>;
}
