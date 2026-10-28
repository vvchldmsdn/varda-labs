import type { Worker } from "tesseract.js";
import { parseBalancePhoto } from "./balance-photo";

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let cancel: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => { cancel = () => reject(new DOMException("Cancelled", "AbortError")); signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel(); });
  try { return await Promise.race([operation, aborted]); } finally { signal.removeEventListener("abort", cancel); }
}

export async function readBrokeragePhotoText(file: File, signal: AbortSignal, progress: (value: number) => void, options: { holdingsNumbers?: boolean; tradeNumbers?: boolean } = {}) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error("format");
  const bitmap = await createImageBitmap(file);
  let worker: Worker | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const stop = () => { void worker?.terminate(); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (bitmap.width * bitmap.height > 16_000_000 || bitmap.width < 250 || bitmap.height < 250) throw new Error("dimensions");
    // Light-gray brokerage table headings are frequently missed without contrast normalization.
    canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const value = pixels.data[offset] * .2126 + pixels.data[offset + 1] * .7152 + pixels.data[offset + 2] * .0722 < 220 ? 0 : 255;
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
    const { createWorker } = await import("tesseract.js");
    const base = new URL("/onboarding-ocr/v1/", window.location.origin).href;
    let numericPass = false;
    const activeWorker = await abortable(createWorker(["kor", "eng"], 1, {
      workerPath: `${base}worker.min.js`, corePath: base.slice(0, -1), langPath: base.slice(0, -1),
      cacheMethod: "none", workerBlobURL: false,
      logger: event => { if (!signal.aborted) progress(event.status === "recognizing text" ? (numericPass ? 75 + Math.round(event.progress * 25) : 30 + Math.round(event.progress * 45)) : 10); },
      errorHandler: () => { /* The operation promise reports a user-facing error; never log OCR text. */ },
    }, { tessedit_load_sublangs: "" } as Partial<import("tesseract.js").InitOptions>).then(created => { worker = created; if (signal.aborted) void created.terminate(); return created; }), signal);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    await activeWorker.setParameters({ tessedit_pageseg_mode: "11" as import("tesseract.js").PSM });
    const { data } = await abortable(activeWorker.recognize(canvas, {}, { text: true, blocks: true }), signal);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const flatten = (page: typeof data) => (page.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => ({ text: line.text.trim(), confidence: line.confidence, bbox: line.bbox }))));
    let lines = flatten(data);
    const header = lines.find(line => /보유수량|잔고수량/.test(line.text.replace(/\s/g, "")));
    if (options.holdingsNumbers && header && !/주문내역|체결수량/.test(data.text.replace(/\s/g, ""))) {
      numericPass = true;
      const left = Math.max(0, Math.floor(header.bbox.x0 - bitmap.width * .08));
      const right = Math.min(bitmap.width, Math.ceil(header.bbox.x1 + bitmap.width * .03));
      const top = header.bbox.y1;
      await activeWorker.setParameters({ tessedit_pageseg_mode: "6" as import("tesseract.js").PSM, tessedit_char_whitelist: "0123456789.," });
      const numbers = await abortable(activeWorker.recognize(canvas, { rectangle: { left, top, width: right - left, height: bitmap.height - top } }, { text: true, blocks: true }), signal);
      // Replace the column, keeping layout/text from the first pass.
      lines = lines.filter(line => !(line.bbox.y0 > top && line.bbox.x0 >= left && line.bbox.x1 <= right)).concat(flatten(numbers.data));
    }
    if (options.tradeNumbers) {
      const { tradeQuantityRegions } = await import("./trade-photo");
      const regions = tradeQuantityRegions(lines, bitmap.width, bitmap.height);
      numericPass = true;
      await activeWorker.setParameters({ tessedit_pageseg_mode: "7" as import("tesseract.js").PSM, tessedit_char_whitelist: "0123456789.," });
      for (const rectangle of regions) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const numbers = await abortable(activeWorker.recognize(canvas, { rectangle }, { text: true, blocks: true }), signal);
        const numericLines = flatten(numbers.data);
        if (numericLines.length !== 1 || !/^\d+(?:\.\d{1,6})?$/.test(numericLines[0].text)) continue;
        lines = lines.filter(line => !(line.bbox.x0 >= rectangle.left && line.bbox.x1 <= rectangle.left + rectangle.width && line.bbox.y0 >= rectangle.top && line.bbox.y1 <= rectangle.top + rectangle.height)).concat(numericLines);
      }
    }
    canvas.width = canvas.height = 0;
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return { lines, width: bitmap.width, height: bitmap.height };
  } finally {
    signal.removeEventListener("abort", stop); bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
    await worker?.terminate();
  }
}

export async function readBalancePhoto(file: File, signal: AbortSignal, progress: (value: number) => void) {
  const page = await readBrokeragePhotoText(file, signal, progress, { holdingsNumbers: true });
  return parseBalancePhoto(page.lines, page.width, page.height);
}
