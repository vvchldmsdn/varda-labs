import { isCurrency, type Currency } from "./money.ts";
import { emptyAmountImport, type QuickAmountImportDraft } from "./quick-amount-import.ts";

export const QUICK_WORKSPACE_KEY = "cairn.quick-portfolio-workspace.v1";
export const QUICK_WORKSPACE_TTL = 24 * 60 * 60 * 1000;
export type QuickWorkspaceRow = { key: string; name: string; value: string; instrumentId: string | null; inputCurrency: Currency };
export type QuickWorkspace = {
  version: 1; expiresAt: number; baseDraftId: string | null; rows: QuickWorkspaceRow[];
  currency: Currency; timeZone: string; fxRate: string; fxChanged: boolean; dirty: boolean; importing: QuickAmountImportDraft;
};
const short = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
/** Only editable fields survive restoration. Images, OCR lines and runtime state never persist. */
export function parseQuickWorkspace(raw: string | null, now = Date.now()): QuickWorkspace | null {
  if (!raw || raw.length > 32_000) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + QUICK_WORKSPACE_TTL
      || !(value.baseDraftId === null || short(value.baseDraftId, 80)) || !isCurrency(value.currency) || !short(value.timeZone, 80)
      || !short(value.fxRate, 40) || typeof value.fxChanged !== "boolean" || typeof value.dirty !== "boolean"
      || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 12) return null;
    try { new Intl.DateTimeFormat("en", { timeZone: value.timeZone }); } catch { return null; }
    const rows: QuickWorkspaceRow[] = [];
    for (const row of value.rows) {
      if (!short(row.key, 80) || !short(row.name, 60) || !short(row.value, 40) || !isCurrency(row.inputCurrency)
        || !(row.instrumentId === null || short(row.instrumentId, 80)) || rows.some(other => other.key === row.key)) return null;
      rows.push({ key: row.key, name: row.name, value: row.value, inputCurrency: row.inputCurrency, instrumentId: row.instrumentId });
    }
    const importing = value.importing ?? emptyAmountImport();
    if (!["manual", "photo", "text"].includes(importing.method) || !short(importing.text, 12_000) || !Array.isArray(importing.rows) || importing.rows.length > 12) return null;
    for (const row of importing.rows) if (!short(row.key, 80) || !short(row.name, 160) || !short(row.value, 40) || !(row.currency === "" || isCurrency(row.currency))) return null;
    return { version: 1, expiresAt: value.expiresAt, baseDraftId: value.baseDraftId, rows, currency: value.currency, timeZone: value.timeZone,
      fxRate: value.fxRate, fxChanged: value.fxChanged, dirty: value.dirty,
      importing: { method: importing.method, text: importing.text, rows: importing.rows.map((row: { key: string; name: string; value: string; currency: Currency | "" }) => ({ key: row.key, name: row.name, value: row.value, currency: row.currency })) } };
  } catch { return null; }
}
