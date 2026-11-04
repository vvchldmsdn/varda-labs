import type { BalanceTextLine } from "./balance-photo";
import { isCurrency, parseMoneyInput, type Currency } from "./money.ts";

/** Imported amounts are review-only composition inputs, never quantities or trades. */
export type QuickAmountRow = { key: string; name: string; value: string; currency: Currency | "" };
export type QuickAmountImport = { state: "review" | "layout_unknown" | "not_balance" | "too_many"; rows: QuickAmountRow[] };
export type QuickAmountImportDraft = { method: "manual" | "text" | "photo"; text: string; rows: QuickAmountRow[] };
export const emptyAmountImport = (): QuickAmountImportDraft => ({ method: "manual", text: "", rows: [] });
const compact = (value: string) => value.replace(/\s/g, "");
const amountHeader = (value: string) => /^(?:평가금액|평가액|현재금액|marketvalue)(?:\((?:원|KRW|USD|달러)\))?$/i.test(compact(value));
const nameHeader = (value: string) => /^(종목명|종목|자산|자산명|asset|name)$/i.test(compact(value));
// Match whole summary labels only: "Vanguard Total Stock Market ETF" is an asset.
const summaryLabel = (value: string) => /^(?:합계|총계|총액|전체|총평가액|총평가금액|전체평가액|전체평가금액|총자산|전체자산|total|grandtotal|portfoliototal|totalvalue|totalmarketvalue|totalassets)$/i.test(compact(value));
const otherSection = /최근조회|최근본종목|관심종목|추천종목|인기종목|recentlyviewed|watchlist/i;
const trades = /주문내역|주문일시|체결수량|체결금액|거래내역|tradehistory/i;
function currencyOf(value: string): Currency | "" {
  const krw = /KRW|₩|원/i.test(value), usd = /USD|\$|달러/i.test(value);
  return krw === usd ? "" : krw ? "KRW" : "USD";
}
function amountCell(value: string, hint: string): Pick<QuickAmountRow, "value" | "currency"> {
  const explicit = currencyOf(value), header = currencyOf(hint);
  const evidence = `${value} ${hint}`;
  const conflicting = /KRW|₩|원/i.test(evidence) && /USD|\$|달러/i.test(evidence);
  const currency = conflicting ? "" : explicit || header;
  const raw = value.trim().replace(/(?:KRW|USD|달러|원|₩|\$)/gi, "").trim();
  // Invalid precision/grouping stays unresolved; never round or use an adjacent number.
  return { value: /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw) ? raw.replaceAll(",", "") : "", currency };
}
function finish(rows: QuickAmountRow[]): QuickAmountImport {
  return rows.length > 12 ? { state: "too_many", rows: [] } : { state: rows.length ? "review" : "layout_unknown", rows };
}
export function quickAmountRowIssue(row: QuickAmountRow): "name" | "currency" | "amount" | null {
  if (!row.name.trim() || row.name.trim().length > 60) return "name";
  if (!isCurrency(row.currency)) return "currency";
  const amount = parseMoneyInput(row.value, row.currency);
  return amount === null || amount < 0 || amount > 1e12 ? "amount" : null;
}
function cells(line: string, separator: string): string[] {
  const result: string[] = []; let current = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted; }
    else if (char === separator && !quoted) { result.push(current.trim()); current = ""; }
    else current += char;
  }
  result.push(current.trim()); return quoted ? [] : result;
}
export function parseQuickAmountText(text: string): QuickAmountImport {
  if (text.length > 12_000) return { state: "too_many", rows: [] };
  if (trades.test(compact(text))) return { state: "not_balance", rows: [] };
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const first = lines[0] ?? "", separator = first.includes("\t") ? "\t" : first.includes("|") ? "|" : ",";
  const header = cells(first, separator), name = header.findIndex(nameHeader), amounts = header.flatMap((cell, i) => amountHeader(cell) ? [i] : []);
  if (name < 0 || amounts.length !== 1) return { state: "layout_unknown", rows: [] };
  const amount = amounts[0], currency = header.findIndex(cell => /^(통화|currency)$/i.test(cell));
  const rows: QuickAmountRow[] = [];
  for (const line of lines.slice(1)) {
    if (otherSection.test(compact(line))) break;
    const row = cells(line, separator);
    if (!row.length) return { state: "layout_unknown", rows: [] };
    // Extra/missing columns could shift quantity or cost into the amount column.
    const aligned = row.length === header.length;
    const label = row[name] ?? "";
    if (summaryLabel(label)) continue;
    rows.push({ key: `text-${rows.length}`, name: label.length <= 160 ? label : "", ...amountCell(aligned ? row[amount] ?? "" : "", aligned ? `${header[amount]} ${currency >= 0 ? row[currency] ?? "" : ""}` : "") });
  }
  return finish(rows);
}
export function parseQuickAmountPhoto(lines: readonly BalanceTextLine[], width: number, height: number): QuickAmountImport {
  const safe = lines.filter(line => line.text.length < 160 && Number.isFinite(line.confidence) && Object.values(line.bbox).every(Number.isFinite));
  if (trades.test(compact(safe.map(line => line.text).join(" ")))) return { state: "not_balance", rows: [] };
  const headers = safe.filter(line => amountHeader(line.text));
  if (headers.length !== 1 || !(width > 0 && height > 0)) return { state: "layout_unknown", rows: [] };
  const header = headers[0], center = (header.bbox.x0 + header.bbox.x1) / 2;
  // A combined OCR line containing several column headers is intentionally unsupported.
  if (header.bbox.x1 - header.bbox.x0 > width * .45) return { state: "layout_unknown", rows: [] };
  const sectionEnd = Math.min(height, ...safe.filter(line => line.bbox.y0 > header.bbox.y1 && otherSection.test(compact(line.text))).map(line => line.bbox.y0));
  const nameColumn = safe.find(line => nameHeader(line.text) && Math.abs(line.bbox.y0 - header.bbox.y0) < height * .04);
  const names = safe.filter(line => line.bbox.y0 > header.bbox.y1 && line.bbox.y0 < sectionEnd
    && line.bbox.x0 < (nameColumn ? nameColumn.bbox.x1 : width * .3) && line.bbox.x1 < header.bbox.x0
    && (/[가-힣a-z]/i.test(line.text) || (nameColumn && /^\d{6}$/.test(compact(line.text))))
    && !summaryLabel(line.text)
    && !/수수료|매입|원가|보유수량|매도가능|기본예탁금|평가금액|손익/.test(compact(line.text)))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rows = names.map((name, index) => {
    const candidates = safe.filter(line => line.bbox.y0 > header.bbox.y1 && line.bbox.y0 < sectionEnd
      && Math.abs((line.bbox.x0 + line.bbox.x1) / 2 - center) < Math.max(width * .045, (header.bbox.x1 - header.bbox.x0) * .6)
      && Math.abs((line.bbox.y0 + line.bbox.y1) / 2 - (name.bbox.y0 + name.bbox.y1) / 2) < Math.max(height * .012, (name.bbox.y1 - name.bbox.y0) * .8));
    const cell = candidates.length === 1 && candidates[0].confidence >= 60 ? candidates[0].text : "";
    return { key: `photo-${index}`, name: name.text.trim(), ...amountCell(cell, header.text) };
  });
  return finish(rows);
}
