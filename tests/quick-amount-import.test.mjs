import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyAmountImport, parseQuickAmountText, parseQuickAmountPhoto, quickAmountRowIssue } from "../src/lib/quick-amount-import.ts";
import { parseQuickWorkspace, QUICK_WORKSPACE_TTL } from "../src/lib/quick-portfolio-workspace.ts";
import { analyzeQuickPortfolio } from "../src/lib/quick-portfolio.ts";
const line = (text, x, y, confidence = 95, width = 110) => ({ text, confidence, bbox: { x0: x, y0: y, x1: x + width, y1: y + 25 } });

describe("guest imports keep amounts separate from quantities and costs", () => {
  it("reads only explicitly named values with original currencies and cents", () => {
    const result = parseQuickAmountText('종목명,수량,평균단가,평가금액,통화\nVOO,0.896567,701.26,"1,234.56",USD\nKODEX 200,22,20000,440000,KRW');
    assert.equal(result.state, "review");
    assert.deepEqual(result.rows.map(row => [row.name, row.value, row.currency]), [["VOO", "1234.56", "USD"], ["KODEX 200", "440000", "KRW"]]);
    assert.equal(result.rows.some(row => Object.hasOwn(row, "quantity") || Object.hasOwn(row, "instrumentId")), false);
    assert.equal(analyzeQuickPortfolio({ currency: "KRW", rows: [{ name: "VOO", value: 440000, instrumentId: null }] }).rows[0].instrument, null);
  });
  it("rejects quantity/unit price/cost-only input and trade records", () => {
    for (const text of ["종목명,수량,단가\nVOO,0.896567,701.26", "종목명,매입금액\nVOO,1000", "종목명,금액\nVOO,1000"]) assert.equal(parseQuickAmountText(text).state, "layout_unknown");
    assert.equal(parseQuickAmountText("종목명,체결금액,평가금액\nVOO,1000,1010").state, "not_balance");
  });
  it("does not infer currencies or round fractional KRW and USD values", () => {
    const result = parseQuickAmountText("종목명|평가금액|통화\nVOO|123.456|USD\n한국자산|0.896567|KRW\n현금|200|");
    assert.deepEqual(result.rows.map(quickAmountRowIssue), ["amount", "amount", "currency"]);
    const conflict = parseQuickAmountText("종목명,평가금액(KRW),통화\nVOO,100 USD,KRW");
    assert.equal(conflict.rows[0].currency, "");
    assert.equal(parseQuickAmountText("종목명,평가액(원)\n한국자산,1000").rows[0].currency, "KRW");
  });
  it("leaves missing or shifted fields unresolved and keeps duplicate rows for review", () => {
    const result = parseQuickAmountText('종목명,평가금액,통화\nVOO,,USD\nVOO,1,234,USD');
    assert.deepEqual(result.rows.map(row => row.value), ["", ""]);
    assert.equal(result.rows.length, 2);
    const duplicate = parseQuickAmountText("종목명,평가금액,통화\nVOO,100,USD\nVOO,200,USD");
    assert.equal(duplicate.rows.length, 2);
  });
  it("stops before recently viewed rows and refuses truncating more than 12 assets", () => {
    assert.equal(parseQuickAmountText("종목명,평가금액,통화\nVOO,100,USD\n최근 조회 종목\nAMZN,200,USD").rows.length, 1);
    const many = "종목명,평가금액,통화\n" + Array.from({ length: 13 }, (_, i) => `A${i},1,USD`).join("\n");
    assert.deepEqual(parseQuickAmountText(many), { state: "too_many", rows: [] });
  });
  it("excludes exact summary rows without dropping assets containing total", () => {
    const text = parseQuickAmountText("종목명,평가금액(원)\nVOO,1000\n합계,4000\nVanguard Total Stock Market ETF,2000\nTOTAL,4000\nTotalEnergies,1000\n총 평가금액,4000");
    assert.deepEqual(text.rows.map(row => [row.name, row.value]), [["VOO", "1000"], ["Vanguard Total Stock Market ETF", "2000"], ["TotalEnergies", "1000"]]);
    const photo = parseQuickAmountPhoto([line("Asset", 60, 300), line("Market value(USD)", 500, 300),
      line("TotalEnergies", 60, 440), line("100.50", 500, 440),
      line("Total assets", 60, 680), line("200.50", 500, 680),
      line("Vanguard Total ETF", 60, 800), line("100.00", 500, 800)], 1000, 2000);
    assert.deepEqual(photo.rows.map(row => [row.name, row.value, row.currency]), [["TotalEnergies", "100.50", "USD"], ["Vanguard Total ETF", "100.00", "USD"]]);
  });
  it("reads the labelled value column in photos and excludes cost, quantity and watchlists", () => {
    const parsed = parseQuickAmountPhoto([line("종목명", 60, 300), line("평가금액(원)", 500, 300), line("보유수량", 800, 300),
      line("VOO", 60, 440), line("491,250", 500, 440), line("499,858", 500, 480), line("0.896567", 800, 440),
      line("최근 조회 종목", 60, 600), line("AMZN", 60, 700), line("200", 500, 700)], 1000, 2000);
    assert.deepEqual(parsed.rows.map(row => [row.name, row.value, row.currency]), [["VOO", "491250", "KRW"]]);
  });
  it("does not borrow the next asset value or accept low-confidence or ambiguous cells", () => {
    const parsed = parseQuickAmountPhoto([line("평가금액(USD)", 500, 300), line("VOO", 60, 440), line("VXUS", 60, 680), line("26.50", 500, 680)], 1000, 2000);
    assert.deepEqual(parsed.rows.map(row => row.value), ["", "26.50"]);
    const low = parseQuickAmountPhoto([line("평가액", 500, 300), line("VOO", 60, 440), line("100 USD", 500, 440, 40)], 1000, 2000);
    assert.equal(low.rows[0].value, ""); assert.equal(low.rows[0].currency, "");
    assert.equal(parseQuickAmountPhoto([line("종목명 평가금액 매입금액", 60, 300, 95, 850)], 1000, 2000).state, "layout_unknown");
    assert.equal(parseQuickAmountPhoto([line("주문내역", 60, 50), line("평가액", 500, 300)], 1000, 2000).state, "not_balance");
  });
  it("keeps six-digit labels in the explicit asset column without assigning an instrument", () => {
    const parsed = parseQuickAmountPhoto([line("종목명", 60, 300), line("평가금액(원)", 500, 300), line("보유수량", 800, 300),
      line("069500", 60, 440), line("440,000", 500, 440), line("123456", 800, 440),
      line("VOO", 60, 680), line("600,000", 500, 680), line("합계", 60, 800), line("1,040,000", 500, 800),
      line("최근 조회 종목", 60, 900), line("395160", 60, 1000), line("200", 500, 1000)], 1000, 2000);
    assert.deepEqual(parsed.rows.map(row => [row.name, row.value, row.currency]), [["069500", "440000", "KRW"], ["VOO", "600000", "KRW"]]);
    assert.equal(Object.hasOwn(parsed.rows[0], "instrumentId"), false);
  });
});

describe("unsubmitted amount workspace", () => {
  const now = Date.now();
  const workspace = () => ({ version: 1, expiresAt: now + QUICK_WORKSPACE_TTL, baseDraftId: null,
    rows: [{ key: "one", name: "VOO", value: "1234.", instrumentId: null, inputCurrency: "USD" }],
    currency: "KRW", timeZone: "Asia/Seoul", fxRate: "", fxChanged: false, dirty: true,
    importing: { ...emptyAmountImport(), method: "text", text: "종목명,평가금액,통화\nVOO,,USD", rows: [{ key: "draft", name: "VOO", value: "", currency: "USD" }] } });
  it("keeps unfinished money, missing import fields and source text before calculation", () => {
    const value = workspace(); assert.deepEqual(parseQuickWorkspace(JSON.stringify(value), now), value);
  });
  it("expires after 24 hours and rejects oversized or invalid restored state", () => {
    const value = workspace(); assert.equal(parseQuickWorkspace(JSON.stringify(value), value.expiresAt), null);
    for (const patch of [{ expiresAt: now + QUICK_WORKSPACE_TTL + 1 }, { rows: [] }, { currency: "JPY" }, { timeZone: "unknown" }, { importing: { method: "photo", rows: [], text: "x".repeat(12001) } }]) assert.equal(parseQuickWorkspace(JSON.stringify({ ...value, ...patch }), now), null);
    assert.equal(parseQuickWorkspace("broken", now), null);
  });
  it("strips source image, raw OCR and unexpected fields from restored state", () => {
    const value = workspace(); value.image = "data:image/png;base64,private"; value.importing.image = value.image; value.importing.rows[0].rawOcr = "private";
    const parsed = parseQuickWorkspace(JSON.stringify(value), now);
    assert.equal(Object.hasOwn(parsed, "image"), false); assert.equal(Object.hasOwn(parsed.importing, "image"), false); assert.equal(Object.hasOwn(parsed.importing.rows[0], "rawOcr"), false);
  });
});
