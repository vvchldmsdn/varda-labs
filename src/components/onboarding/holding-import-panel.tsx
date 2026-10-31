"use client";

import { useState } from "react";
import { Check, FileSpreadsheet } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { InstrumentSearch, type InstrumentChoice } from "./instrument-search";
import { parseHoldingImport, type ImportedHolding, type HoldingImportResult } from "@/lib/holding-import";
import type { HoldingDraft } from "@/lib/holding-batch";
import { Button as CairnButton, Field as CairnField, Input as CairnInput, Status as CairnStatus, Textarea as CairnTextarea } from "@/components/cairn-ui";
import styles from "./holding-import-panel.module.css";


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
  return <details className={styles.panel}>
    <summary><FileSpreadsheet size={22} aria-hidden="true" />{t("표·CSV로 여러 종목 가져오기", "Import a table or CSV")}</summary>
    <div className={styles.content}>
    <p className={styles.note}>{t("종목명·수량 두 열이면 돼요. 평균매입가는 선택이에요.", "Start with name and quantity. Average cost is optional.")}</p>
    <CairnTextarea className={styles.tableInput} disabled={disabled} aria-label={t("보유종목 표", "Holdings table")} rows={5} maxLength={64_000} value={text} onChange={event => { setText(event.target.value); setRows([]); }} placeholder={t("종목명,수량\nKODEX 200,10\nVOO,2", "name,quantity\nKODEX 200,10\nVOO,2")} />
    <CairnField className={styles.file}>{t("CSV 파일 선택", "Choose CSV")}<CairnInput disabled={disabled} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 64_000) { setError("size"); return; }
      try { setText(await file.text()); setRows([]); setError(null); } catch { setError("unreadable"); }
    }} /></CairnField>
    <CairnButton variant="secondary" type="button" disabled={disabled || !text.trim() || remaining < 1} onClick={confirm}>{t("표 읽고 종목 확인", "Read and review holdings")}</CairnButton>
    {error && <CairnStatus as="p" tone="danger" role="alert">{messages[error]}</CairnStatus>}
    {rows.length > 0 && <>
      <div className={styles.reviewHeading}><strong>{t("검색 결과와 연결해 주세요", "Match your holdings")}</strong><span>{rows.filter(row => row.instrument).length}/{rows.length}</span></div>
      <div className={styles.rows}>{rows.map((row, index) => <CairnButton variant="selection" type="button" key={index} disabled={disabled} aria-pressed={reviewIndex === index} onClick={() => setReviewIndex(index)}>{row.instrument && <Check size={17} aria-hidden="true" />}<span>{row.label}</span><small>{row.quantity}</small></CairnButton>)}</div>
      <p className={styles.current}><strong>{rows[reviewIndex].label}</strong> · {t("종목 확인", "Verify instrument")}</p>
      <InstrumentSearch key={reviewIndex} initialQuery={rows[reviewIndex].label} onSelect={select} disabled={disabled} preview={preview} />
      <CairnButton variant="primary" type="button" disabled={disabled || rows.some(row => !row.instrument) || rows.length > remaining} onClick={() => {
        const added = onAdd(rows.map(row => ({ key: crypto.randomUUID(), instrumentId: row.instrument!.id, name: row.instrument!.name, ticker: row.instrument!.ticker, market: row.instrument!.market, assetType: row.instrument!.assetType, quantity: row.quantity, averageCost: row.averageCost, currentPrice: "" })));
        if (added) { setRows([]); setText(""); setError(null); } else { setError("queue"); }
      }}>{t("확인 목록으로 가져오기", "Add to review list")}</CairnButton>
    </>}
    <p className={styles.note}>{t("기기에서 읽기 · 확인 목록에 담은 뒤 저장해요.", "Read on this device · Save after checking your review list.")}</p>
    </div>
  </details>;
}
