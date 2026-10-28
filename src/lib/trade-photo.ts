import { Decimal } from "./money.ts";
import type { BalanceTextLine } from "./balance-photo";

export type TradePhotoCandidate = {
  label: string; side: "buy" | "sell"; date: string; quantity: string;
  price: string; currency: "USD" | "KRW" | ""; gross: string;
  priceSource: "reported" | "derived" | "missing";
};
const compact = (text: string) => text.replace(/\s/g, "");
export function tradePhotoNumber(value: string, scale = 12): string | null {
  const text = value.trim().replace(/(?:USD|KRW|달러|원|주)$/i, "").trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text) || (text.split(".")[1]?.length ?? 0) > scale || text.length > 30) return null;
  try { const number = Decimal.from(text.replaceAll(",", "")); return number.compare(0) > 0 && number.compare("1000000000000") <= 0 ? number.toExactString() : null; } catch { return null; }
}
export function tradePhotoDate(text: string): string {
  const match = /\b(20\d{2})[.\-/](\d{2})[.\-/](\d{2})\b/.exec(text);
  if (!match) return "";
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : "";
}
const center = (line: BalanceTextLine) => (line.bbox.y0 + line.bbox.y1) / 2;
const currencyOf = (text: string): TradePhotoCandidate["currency"] => /USD|달러/i.test(text) ? "USD" : /KRW|원/i.test(text) ? "KRW" : "";

/** Only the explicitly labeled fill-quantity cells get a numeric OCR pass. */
export function tradeQuantityRegions(lines: BalanceTextLine[], width: number, height: number) {
  const detail = lines.some(line => /체결가격|체결단가|주문일시/.test(compact(line.text)));
  return lines.filter(line => compact(line.text) === "체결수량").slice(0, 50).map(label => {
    const h = label.bbox.y1 - label.bbox.y0;
    const left = Math.floor(detail ? width * .55 : Math.max(0, label.bbox.x0 - width * .025));
    const top = Math.floor(detail ? Math.max(0, label.bbox.y0 - h * .3) : label.bbox.y1 + 2);
    const right = Math.ceil(detail ? width * .96 : Math.min(width, label.bbox.x0 + width * .22));
    const bottom = Math.ceil(Math.min(height, detail ? label.bbox.y1 + h * .4 : top + h * 2.5));
    return { left, top, width: right - left, height: bottom - top };
  }).filter(rect => rect.width > 0 && rect.height > 0);
}

/** Layout evidence only. Order amounts/prices/quantities and settlement cash are never fills.
 * Dates are candidates, even when an order timestamp is printed. The review must confirm them. */
export function parseTradePhoto(lines: BalanceTextLine[], width: number, height: number) {
  const rows: TradePhotoCandidate[] = []; let excluded = 0;
  if (width <= 0 || height <= 0 || lines.length > 4000) return { rows, excluded };
  const sorted = lines.filter(line => line.text.trim()).toSorted((a, b) => center(a) - center(b) || a.bbox.x0 - b.bbox.x0);
  const starts = sorted.filter(line => /^(매수|매도)(?:\s|$)/.test(line.text.trim()) && !/접수|처리|완료|가능/.test(line.text));
  for (let index = 0; index < starts.length && rows.length < 50; index++) {
    const start = starts[index], end = starts[index + 1]?.bbox.y0 ?? height;
    const block = sorted.filter(line => center(line) >= start.bbox.y0 && center(line) < end);
    if (block.some(line => /자동취소|취소완료|미체결/.test(compact(line.text))) || /취소/.test(start.text)) { excluded++; continue; }
    const quantityHeader = block.find(line => /체결수량/.test(compact(line.text)));
    if (!quantityHeader) continue;
    const detail = block.some(line => /체결가격|체결단가|주문일시/.test(compact(line.text)));
    function field(pattern: RegExp) {
      const label = block.find(line => compact(line.text).match(pattern)?.index === 0); if (!label) return "";
      const inline = compact(label.text).replace(pattern, "");
      if (/^\d/.test(inline)) return inline;
      const candidates = block.filter(line => line !== label && /^\d/.test(line.text.trim()));
      const near = detail ? candidates.filter(line => line.bbox.x0 > label.bbox.x1 && Math.abs(center(line) - center(label)) <= Math.max(24, label.bbox.y1 - label.bbox.y0))
        : candidates.filter(line => line.bbox.y0 >= label.bbox.y1 && line.bbox.y0 - label.bbox.y1 < height * .055 && Math.abs(line.bbox.x0 - label.bbox.x0) < width * .09);
      return near.toSorted((a, b) => Math.abs(center(a) - center(label)) - Math.abs(center(b) - center(label)))[0]?.text ?? "";
    }
    const rawQuantity = field(/체결수량/);
    if (/^0(?:\.0+)?(?:주)?$/.test(compact(rawQuantity))) { excluded++; continue; }
    const quantity = tradePhotoNumber(rawQuantity, 6) ?? "";
    const rawPrice = detail ? field(/체결가격|체결단가/) : "";
    const rawGross = field(/체결금액/), gross = tradePhotoNumber(rawGross) ?? "";
    let price = tradePhotoNumber(rawPrice) ?? "";
    let priceSource: TradePhotoCandidate["priceSource"] = price ? "reported" : "missing";
    // A list's left column is the LIMIT ORDER price. Derive only from the actual fill columns.
    if (!detail && quantity && gross) {
      try { price = tradePhotoNumber(Decimal.from(gross).div(quantity).toExactString()) ?? ""; if (price) priceSource = "derived"; } catch { /* Recurring averages need an explicit price; never round it. */ }
    }
    const date = block.map(line => tradePhotoDate(line.text)).find(Boolean) ?? "";
    const firstField = block.find(line => /주문일시|주문금액|체결가격|체결단가/.test(compact(line.text)))?.bbox.y0 ?? quantityHeader.bbox.y0;
    const labels = block.filter(line => line !== start && line.bbox.y0 < firstField && line.bbox.x0 < width * .7 &&
      /[가-힣A-Za-z]/.test(line.text) && !/예약|주문|체결|결제|소수점|완료|정정|취소|USD|KRW|계좌|확인|국내|해외|일반/.test(compact(line.text)) && !tradePhotoDate(line.text));
    const nameLines = detail && labels.length ? labels.filter(line => line.bbox.y0 <= labels[0].bbox.y1) : labels;
    const label = nameLines.map(line => line.text.trim()).join(" · ").slice(0, 120);
    // No usable fill evidence: don't fabricate a blank transaction from a clipped card.
    if (!quantity && !gross && !price) continue;
    rows.push({ label: label || "종목 확인 필요", side: start.text.trim().startsWith("매수") ? "buy" : "sell", date, quantity, price, currency: currencyOf(rawPrice) || currencyOf(rawGross), gross, priceSource });
  }
  return { rows, excluded };
}
