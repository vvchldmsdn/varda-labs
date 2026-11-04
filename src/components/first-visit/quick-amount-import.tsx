"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Select, Status, Textarea } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { parseQuickAmountPhoto, parseQuickAmountText, quickAmountRowIssue, type QuickAmountImport, type QuickAmountImportDraft, type QuickAmountRow } from "@/lib/quick-amount-import";
import { MoneyInput } from "./money-input";
import styles from "./quick-amount-import.module.css";

type Props = { draft: QuickAmountImportDraft; onChange: (draft: QuickAmountImportDraft) => void; onConfirm: (rows: QuickAmountRow[]) => boolean; submissionError?: string };
export function QuickAmountImportPanel({ draft, onChange, onConfirm, submissionError }: Props) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const request = useRef(0), controller = useRef<AbortController | null>(null), review = useRef<HTMLHeadingElement>(null);
  const latest = useRef(draft);
  useEffect(() => { latest.current = draft; }, [draft]);
  useEffect(() => () => { request.current++; controller.current?.abort(); }, []);
  function stop() { request.current++; controller.current?.abort(); controller.current = null; setProgress(null); }
  function accept(result: QuickAmountImport) {
    setAttempted(false);
    if (result.state !== "review") {
      setError(result.state === "not_balance" ? t("거래 내역 대신 현재 잔고의 평가금액을 올려 주세요.", "Use current holding values, not a trade history.")
        : result.state === "too_many" ? t("한 번에 12개 자산까지 확인할 수 있어요.", "Review up to 12 assets at a time.")
          : t("평가금액 열을 찾지 못했어요. 아래 예시대로 텍스트를 넣거나 직접 입력해 주세요.", "Could not find a market-value column. Use the text example or enter your amounts."));
      return;
    }
    onChange({ ...latest.current, rows: result.rows }); setError("");
    requestAnimationFrame(() => review.current?.focus());
  }
  async function photo(file: File) {
    stop(); const generation = request.current, abort = new AbortController(); controller.current = abort;
    setError(""); setProgress(0);
    try {
      const { readBrokeragePhotoText } = await import("@/lib/balance-photo-reader");
      const value = await readBrokeragePhotoText(file, abort.signal, amount => { if (request.current === generation) setProgress(amount); });
      if (request.current === generation && !abort.signal.aborted) accept(parseQuickAmountPhoto(value.lines, value.width, value.height));
    } catch {
      if (request.current === generation && !abort.signal.aborted) setError(t("사진을 읽지 못했어요. 선명한 JPG·PNG·WebP(12MB 이하)로 다시 시도하거나 텍스트로 입력해 주세요.", "Could not read the photo. Try a clear JPG, PNG or WebP under 12 MB, or use text."));
    } finally { if (request.current === generation) { setProgress(null); controller.current = null; } }
  }
  function update(key: string, patch: Partial<QuickAmountRow>) { onChange({ ...draft, rows: draft.rows.map(row => row.key === key ? { ...row, ...patch } : row) }); }
  function confirm() {
    setAttempted(true);
    if (draft.rows.some(row => quickAmountRowIssue(row))) { requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-amount-review] [aria-invalid="true"]')?.focus()); return; }
    if (onConfirm(draft.rows)) { onChange({ method: "manual", text: "", rows: [] }); setAttempted(false); }
  }
  return <section className={styles.importer} aria-label={t("자산 입력 방법", "Asset input method")}>
    <div className={styles.methods} aria-label={t("입력 방법 선택", "Choose input method")}>
      {(["photo", "text", "manual"] as const).map(method => <Button key={method} type="button" variant="bare" aria-pressed={draft.method === method} onClick={() => { stop(); setError(""); onChange({ ...draft, method }); }}>{method === "photo" ? t("캡처", "Photo") : method === "text" ? t("텍스트", "Text") : t("직접 입력", "Enter amounts")}</Button>)}
    </div>
    {draft.method !== "manual" ? <div className={styles.stage}>
      {draft.rows.length ? <div data-amount-review>
        <h2 ref={review} tabIndex={-1}>{t("평가금액이 맞는지 확인해 주세요", "Check your holding values")}</h2>
        <p>{t("수량이나 매입원가가 아닌, 지금 보유한 자산의 금액이에요.", "Use each holding’s current value, not its quantity or purchase cost.")}</p>
        <p className={styles.note}>{t("읽은 항목을 확인하고 빠진 자산은 직접 추가해 주세요.", "Review the recognized items and add any missing assets manually.")}</p>
        {draft.rows.map((row, index) => {
          const issue = quickAmountRowIssue(row), invalid = attempted ? issue : null;
          const issueId = `quick-import-${index}-issue`;
          return <div className={styles.row} key={row.key}>
            <Field className={styles.name}>{t("자산", "Asset")}<Input maxLength={60} value={row.name} aria-label={t(`가져온 자산 ${index + 1} 이름`, `Imported asset ${index + 1} name`)} aria-invalid={invalid === "name"} aria-describedby={invalid === "name" ? issueId : undefined} onChange={event => update(row.key, { name: event.target.value })} /></Field>
            <Field>{t("평가금액", "Market value")}<MoneyInput value={row.value} allowDecimals={row.currency !== "KRW"} aria-label={t(`가져온 자산 ${index + 1} 평가금액`, `Imported asset ${index + 1} value`)} aria-invalid={invalid === "amount"} aria-describedby={invalid === "amount" ? issueId : undefined} onValueChange={value => update(row.key, { value })} /></Field>
            <Field>{t("통화", "Currency")}<Select value={row.currency} aria-label={t(`가져온 자산 ${index + 1} 통화`, `Imported asset ${index + 1} currency`)} aria-invalid={invalid === "currency"} aria-describedby={invalid === "currency" ? issueId : undefined} onChange={event => update(row.key, { currency: event.target.value as QuickAmountRow["currency"] })}><option value="">{t("선택", "Select")}</option><option value="KRW">KRW</option><option value="USD">USD</option></Select></Field>
            <Button variant="ghost" type="button" aria-label={t(`가져온 자산 ${index + 1} 제외`, `Remove imported asset ${index + 1}`)} onClick={() => onChange({ ...draft, rows: draft.rows.filter(item => item.key !== row.key) })}>×</Button>
            {issue ? <p id={issueId} className={styles.issue} role={attempted ? "alert" : undefined}>{issue === "currency" ? t("사진·텍스트에 없는 통화를 선택해 주세요.", "Choose the currency missing from the source.") : issue === "name" ? t("자산 이름을 확인해 주세요.", "Check the asset name.") : t("평가금액을 확인해 주세요. 원은 정수, 달러는 소수 둘째 자리까지예요.", "Check the value: whole won or up to two decimal places for dollars.")}</p> : null}
          </div>;
        })}
        <div className={styles.actions}><Button type="button" variant="primary" onClick={confirm}>{t(`${draft.rows.length}개 금액 확인하고 사용`, `Use these ${draft.rows.length} checked values`)}</Button><Button type="button" variant="ghost" onClick={() => onChange({ ...draft, rows: [] })}>{t("자료 다시 선택", "Choose another source")}</Button></div>
      </div> : <>
        <h2>{draft.method === "photo" ? t("잔고 화면을 올려 주세요", "Add a balance screenshot") : t("자산 이름과 평가금액을 붙여 넣으세요", "Paste asset names and current values")}</h2>
        {draft.method === "photo" ? <><p>{t("종목명·평가금액·통화가 보이도록 계좌번호를 가려 주세요.", "Show asset names, current values and currencies. Hide your account number.")}</p><Field className={styles.upload}>{t("사진 선택", "Choose photo")}<Input type="file" accept="image/jpeg,image/png,image/webp" disabled={progress !== null} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void photo(file); }} /></Field><p className={styles.note}>{t("이 기기에서만 읽어요. 사진은 전송하거나 보관하지 않아요.", "Read on this device. Photos are neither uploaded nor saved.")}</p></>
          : <><Field>{t("평가금액이 있는 표", "Table of current values")}<Textarea className={styles.textarea} maxLength={12_000} rows={6} value={draft.text} placeholder={"종목명,평가금액,통화\nVOO,6000000,KRW\nKODEX 200,4000000,KRW"} onChange={event => onChange({ ...draft, text: event.target.value })} /></Field><Button type="button" variant="primary" disabled={!draft.text.trim()} onClick={() => accept(parseQuickAmountText(draft.text))}>{t("금액 읽어오기", "Read values")}</Button></>}
        {progress !== null ? <div className={styles.progress}><Status as="p" role="status">{t(`사진을 읽고 있어요 · ${progress}%`, `Reading photo · ${progress}%`)}</Status><progress max={100} value={progress} aria-label={t("사진 읽기 진행", "Photo reading progress")} /><Button type="button" variant="ghost" onClick={stop}>{t("취소", "Cancel")}</Button></div> : null}
      </>}
      {error || submissionError ? <Status as="p" tone="danger" role="alert">{error || submissionError}</Status> : null}
      <Button type="button" variant="ghost" onClick={() => { stop(); onChange({ ...draft, method: "manual" }); }}>{t("입력하던 자산으로 돌아가기", "Back to my asset inputs")}</Button>
    </div> : null}
  </section>;
}
