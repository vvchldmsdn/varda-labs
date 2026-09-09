import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHoldingImport } from "../src/lib/holding-import.ts";

describe("holdings text import", () => {
  it("preserves tickers, fractional quantities, and unknown cost without inventing values", () => {
    assert.deepEqual(parseHoldingImport("\uFEFF티커,수량,평균매입가\r\n069500,10,\r\nVOO,0.000001,500.1234"), { error: null, rows: [{ label: "069500", quantity: "10", averageCost: "" }, { label: "VOO", quantity: "0.000001", averageCost: "500.1234" }] });
  });
  it("accepts spreadsheet tabs and quoted CSV names", () => {
    assert.equal(parseHoldingImport("name\tquantity\nSome stock\t2").rows[0].label, "Some stock");
    assert.equal(parseHoldingImport('name,quantity\n"Company, Inc.",2').rows[0].label, "Company, Inc.");
    assert.equal(parseHoldingImport('name,quantity\n"Company ""A""",2').rows[0].label, 'Company "A"');
  });
  it("does not reinterpret total cost basis as a per-unit purchase price", () => {
    for (const heading of ["costbasis", "cost basis", "원가", "매입금액", "totalcost"]) assert.equal(parseHoldingImport(`ticker,quantity,${heading}\nABC,10,1000`).error, "cost_unit");
    assert.equal(parseHoldingImport("ticker,quantity,averageCost\nABC,10,100").rows[0].averageCost, "100");
  });
  it("rejects ambiguous numbers, formula cells and unsupported precision", () => {
    for (const quantity of ["0", "-2", "NaN", "Infinity", "1e3", "=2+2", "0.0000001", '"1,000"']) assert.equal(parseHoldingImport(`ticker,quantity\nABC,${quantity}`).error, "number");
    assert.equal(parseHoldingImport("ticker,quantity,averageCost\nABC,1,0").error, "number");
  });
  it("fails closed on malformed rows, duplicate instruments, oversized or ambiguous inputs", () => {
    assert.equal(parseHoldingImport('name,quantity\n"ABC,2').error, "format");
    assert.equal(parseHoldingImport('name,quantity\n"ABC"x,2').error, "format");
    assert.equal(parseHoldingImport("name,quantity\nABC,2,3").error, "format");
    assert.equal(parseHoldingImport("name,quantity\nABC,1\nabc,2").error, "duplicate");
    assert.equal(parseHoldingImport("name,quantity\nABC,1\nDEF,2", 1).error, "rows");
    assert.equal(parseHoldingImport("x".repeat(64001)).error, "size");
    assert.equal(parseHoldingImport("name,value\nABC,1000").error, "headers");
  });
});
