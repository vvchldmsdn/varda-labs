"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { InstrumentSearch, type InstrumentChoice } from "./instrument-search";
import { parseHoldingImport, type ImportedHolding, type HoldingImportResult } from "@/lib/holding-import";
import type { HoldingDraft } from "@/lib/holding-batch";

export function HoldingImportPanel({ onAdd, remaining, disabled, preview = false }: {
  onAdd: (rows: HoldingDraft[]) => boolean; remaining: number; disabled: boolean; preview?: boolean;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<(ImportedHolding & { instrument?: InstrumentChoice })[]>([]);
  const [error, setError] = useState<HoldingImportResult["error"] | "unreadable" | "queue">(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const messages = {
    size: t("64KB 이하의 CSV 파일을 사용해 주세요.", "Use a CSV file smaller than 64 KB."),
    format: t("표의 열 수와 따옴표를 확인해 주세요.", "Check the column count and quotes."),
    headers: t("첫 줄에 종목명(또는 티커), 수량을 넣어 주세요. 평균매입가는 선택입니다.", "Include name (or ticker) and quantity in the first row. Average cost is optional."),
    cost_unit: t("총 매입금액을 평균매입가로 사용하지 않습니다. 원가 열을 빼거나 1주당 가격인지 확인 후 평균매입가로 표시해 주세요.", "Total purchase cost is not an average unit cost. Remove the cost column, or verify it is a per-unit price and label it averageCost."),
    rows: t(`한 번에 ${remaining}개까지 더 추가할 수 있습니다.`, `You can add ${remaining} more holdings at a time.`),
    number: t("수량은 양수여야 합니다. 천 단위 쉼표·통화기호·수식 없이 입력해 주세요.", "Use positive quantities, without thousands separators, currency symbols or formulas."),
    duplicate: t("같은 이름 또는 티커가 중복되었습니다. 수량을 확인해 한 줄로 합쳐 주세요.", "A name or ticker is repeated. Review the quantities and combine it into one row."),
    unreadable: t("파일을 읽지 못했습니다.", "Could not read the file."),
    queue: t("확인 목록에 같은 종목이 있거나 목록이 가득 찼습니다. 입력은 그대로 보존했습니다.", "The review list contains a duplicate or is full. Your input has been preserved."),
  };
  const confirm = () => {
    const parsed = parseHoldingImport(text, remaining);
    if (parsed.error) { setError(parsed.error); setRows([]); return; }
    setRows(parsed.rows); setReviewIndex(0); setError(null);
  };
  function select(instrument: InstrumentChoice) {
    if (rows.some((row, index) => index !== reviewIndex && row.instrument?.market === instrument.market && row.instrument?.ticker === instrument.ticker)) { setError("duplicate"); return; }
    setRows(rows.map((row, index) => index === reviewIndex ? { ...row, instrument } : row)); setError(null);
    const next = rows.findIndex((row, index) => index !== reviewIndex && !row.instrument);
    if (next >= 0) setReviewIndex(next);
  }
  return <details className="varda-onboarding-details">
    <summary>{t("표 붙여넣기 / CSV로 여러 종목 가져오기", "Paste a table / import holdings from CSV")}</summary>
    <p>{t("종목명과 수량 두 열이면 됩니다. 파일 내용은 이 브라우저에서 읽고, 종목을 확인한 뒤에만 저장합니다.", "Start with two columns: name and quantity. Files are read in this browser; holdings are saved only after review.")}</p>
    <textarea disabled={disabled} aria-label={t("보유종목 표", "Holdings table")} rows={5} maxLength={64_000} value={text} onChange={event => { setText(event.target.value); setRows([]); }} placeholder={t("종목명,수량,평균매입가\nKODEX 200,10,\nVOO,2,", "name,quantity,averageCost\nKODEX 200,10,\nVOO,2,")} style={{ width: "100%", padding: 12, border: "1px solid var(--line)", background: "var(--surface)", borderRadius: 8, color: "var(--ink)", fontSize: 12 }} />
    <label className="varda-onboarding-text-button">{t("CSV 파일 선택", "Choose CSV")}<input disabled={disabled} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 64_000) { setError("size"); return; }
      try { setText(await file.text()); setRows([]); setError(null); } catch { setError("unreadable"); }
    }} /></label>
    <button className="varda-onboarding-text-button" type="button" disabled={disabled || !text.trim() || remaining < 1} onClick={confirm}>{t("표 읽고 종목 확인", "Read table and verify instruments")}</button>
    {error && <p role="alert">{messages[error]}</p>}
    {rows.length > 0 && <>
      <p>{t("비슷한 이름의 다른 종목을 막기 위해 각 종목을 검색 결과와 연결해 주세요.", "Match each row to a search result to avoid choosing a different instrument with a similar name.")}</p>
      <div className="flex flex-wrap gap-2">{rows.map((row, index) => <button type="button" key={index} disabled={disabled} className="varda-onboarding-text-button" aria-pressed={reviewIndex === index} onClick={() => setReviewIndex(index)}>{row.instrument ? "✓ " : "○ "}{row.label} · {row.quantity}</button>)}</div>
      <p><strong>{rows[reviewIndex].label}</strong> · {t("종목 확인", "Verify instrument")}</p>
      <InstrumentSearch key={reviewIndex} initialQuery={rows[reviewIndex].label} onSelect={select} disabled={disabled} preview={preview} />
      <button className="varda-onboarding-primary" type="button" disabled={disabled || rows.some(row => !row.instrument) || rows.length > remaining} onClick={() => {
        const added = onAdd(rows.map(row => ({ key: crypto.randomUUID(), instrumentId: row.instrument!.id, name: row.instrument!.name, ticker: row.instrument!.ticker, market: row.instrument!.market, assetType: row.instrument!.assetType, quantity: row.quantity, averageCost: row.averageCost, currentPrice: "" })));
        if (added) { setRows([]); setText(""); setError(null); } else { setError("queue"); }
      }}>{t("확인 목록으로 가져오기", "Add to review list")}</button>
    </>}
  </details>;
}
