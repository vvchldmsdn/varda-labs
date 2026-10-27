export type ImportedHolding = { label: string; quantity: string; averageCost: string };
export type HoldingImportResult = { rows: ImportedHolding[]; error: "size" | "format" | "headers" | "cost_unit" | "rows" | "number" | "duplicate" | null };
const fail = (error: HoldingImportResult["error"]): HoldingImportResult => ({ rows: [], error });

/** Text stays local to the review UI. No formulas, numeric coercion or inferred cost. */
export function parseHoldingImport(text: string, maximumRows = 12): HoldingImportResult {
  if (text.length > 64_000) return fail("size");
  const input = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const delimiter = input.split("\n")[0]?.includes("\t") ? "\t" : ",";
  const table: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i <= input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === undefined) return fail("format");
      if (char === '"') { if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === delimiter || char === "\n" || char === undefined) {
      row.push(cell.trim()); cell = ""; closed = false;
      if (char !== delimiter) { if (row.some(Boolean)) table.push(row); row = []; }
    } else if (char === '"' && cell.length === 0 && !closed) quoted = true;
    else if (char === '"' || closed) return fail("format");
    else cell += char;
  }
  if (table.length < 2) return fail("headers");
  const header = table[0].map(item => item.toLowerCase().replace(/[ _]/g, ""));
  const column = (aliases: string[]) => header.findIndex(value => aliases.includes(value));
  const labelColumn = column(["종목", "종목명", "티커", "name", "ticker", "symbol"]);
  const quantityColumn = column(["수량", "보유수량", "quantity", "shares", "units"]);
  const costColumn = column(["평균매입가", "매입평균가", "평균매입가격", "averagecost", "averagepurchaseprice", "costperunit"]);
  if (costColumn < 0 && column(["원가", "매입금액", "costbasis", "totalcost", "cost"]) >= 0) return fail("cost_unit");
  if (labelColumn < 0 || quantityColumn < 0 || new Set(header).size !== header.length) return fail("headers");
  if (table.length - 1 > maximumRows) return fail("rows");
  const result: ImportedHolding[] = [];
  const seen = new Set<string>();
  const decimal = (value: string, precision: number) => new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`).test(value) && Number(value) > 0 && Number.isFinite(Number(value));
  for (const values of table.slice(1)) {
    if (values.length !== header.length) return fail("format");
    const label = values[labelColumn], quantity = values[quantityColumn], averageCost = costColumn < 0 ? "" : values[costColumn];
    if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) return fail("format");
    if (!decimal(quantity, 6) || (averageCost !== "" && !decimal(averageCost, 4))) return fail("number");
    const key = label.toLowerCase();
    if (seen.has(key)) return fail("duplicate");
    seen.add(key); result.push({ label, quantity, averageCost });
  }
  return { rows: result, error: null };
}
