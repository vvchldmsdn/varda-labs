/** Untrusted OCR is a draft, never an instrument identity or a ledger event. */
export type BalanceTextLine = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type BalancePhotoRow = { label: string; quantity: string; confidence: number };
export type BalancePhotoResult = { state: "review" | "not_balance" | "layout_unknown"; rows: BalancePhotoRow[] };
const compact = (text: string) => text.replace(/\s/g, "");
export function balanceQuantity(value: string): string | null {
  const text = value.trim().replace(/주$/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(text)) return null;
  const normalized = text.replace(/,/g, "");
  return Number(normalized) > 0 && Number.isFinite(Number(normalized)) && Number(normalized) <= 1e12 ? normalized : null;
}

export function parseBalancePhoto(lines: readonly BalanceTextLine[], width: number, height: number): BalancePhotoResult {
  const safe = lines.filter(line => line.text.length < 160 && Object.values(line.bbox).every(Number.isFinite));
  const text = compact(safe.map(line => line.text).join(" "));
  // A trade quantity cannot establish a current position.
  if (/주문내역|주문일시|체결수량|체결금액/.test(text)) return { state: "not_balance", rows: [] };
  const header = safe.find(line => /보유수량|잔고수량/.test(compact(line.text)));
  if (!header || !(width > 0 && height > 0)) return { state: "layout_unknown", rows: [] };
  const center = (header.bbox.x0 + header.bbox.x1) / 2;
  // Locate only the explicitly labelled holdings column, never price/cost columns.
  const tolerance = Math.max(header.bbox.x1 - header.bbox.x0, width * .13) * .72;
  const numbers = safe.map(line => ({ ...line, quantity: balanceQuantity(compact(line.text)) }))
    .filter(line => line.quantity && line.bbox.y0 > header.bbox.y1 && Math.abs((line.bbox.x0 + line.bbox.x1) / 2 - center) < tolerance);
  const lastQuantityY = Math.max(header.bbox.y1, ...numbers.map(line => line.bbox.y1));
  const names = safe.filter(line => line.bbox.y0 > header.bbox.y1 && line.bbox.y0 < lastQuantityY && line.bbox.x1 < center - tolerance
    && line.bbox.x0 < width * .3 && /[가-힣A-Za-z]/.test(line.text)
    && !/수수료|평가금액|포함|매도가능|보유종목|기본예탁금/.test(compact(line.text)))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const groups: BalanceTextLine[] = [];
  for (const line of names) {
    const previous = groups.at(-1);
    if (previous && line.bbox.y0 - previous.bbox.y1 < height * .018) {
      previous.text += " " + line.text; previous.bbox.y1 = line.bbox.y1;
      previous.confidence = Math.min(previous.confidence, line.confidence);
    } else groups.push({ ...line, bbox: { ...line.bbox } });
  }
  const rows = groups.slice(0, 24).map((line, index) => {
    const next = groups[index + 1];
    const candidates = numbers.filter(number => number.bbox.y0 >= line.bbox.y0 - height * .035
      && number.bbox.y1 < Math.min(next ? next.bbox.y0 - height * .035 : Infinity, line.bbox.y1 + height * .035));
    // Brokers often stack saleable quantity over holdings. The lower cell is the holdings cell.
    const chosen = candidates.sort((a, b) => a.bbox.y0 - b.bbox.y0).at(-1);
    return { label: line.text.trim(), quantity: chosen?.quantity ?? "", confidence: Math.min(line.confidence, chosen?.confidence ?? 0) };
  });
  return { state: rows.length ? "review" : "layout_unknown", rows };
}
