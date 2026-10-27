import { Decimal, isCurrency, type Currency } from "../../src/lib/money.ts";

/** Private operator input, never an app mutation. IDs identify statement rows, not amounts. */
export type BrokerCashRow = {
  id: string;
  date: string;
  currency: Currency;
  kind: "deposit" | "withdrawal" | "buy_settlement" | "sell_settlement" | "security_delivery";
  amount: string;
  balance: string;
  evidence: string[];
};
export type BrokerTradeLink = {
  rowId: string;
  tradeId: string;
  ticker: string;
  tradeDate: string;
  side: "buy" | "sell";
  quantity: string;
  confirmed: boolean;
  executionGross?: { amount: string; currency: Currency };
  originalDisplay?: { amount: string; currency: Currency };
};
export type BrokerCashStatement = {
  currency: Currency;
  rows: BrokerCashRow[]; // chronological statement order, not guessed execution order
  expectedClosing: string;
  links: BrokerTradeLink[];
};

function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
function date(value: string) {
  check(/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "invalid_statement_date");
}
function amount(value: string, currency: Currency) {
  check(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value), "invalid_statement_amount");
  const result = Decimal.from(value);
  result.minor(currency, "exact");
  return result;
}
function identity(row: BrokerCashRow) {
  return JSON.stringify([row.date, row.currency, row.kind, Decimal.from(row.amount).toExactString(), Decimal.from(row.balance).toExactString()]);
}

/** Reconciles *settled* cash. It never infers fills, fees, FX, execution times or holdings. */
export function reconcileBrokerCash(input: BrokerCashStatement) {
  check(isCurrency(input.currency), "invalid_statement_currency");
  const closing = amount(input.expectedClosing, input.currency);
  check(input.rows.length > 0 && input.rows.length <= 10_000, "invalid_statement_size");
  const unique = new Map<string, BrokerCashRow>();
  let duplicateRows = 0;
  for (const row of input.rows) {
    check(typeof row.id === "string" && row.id.length > 0 && row.id.length <= 160, "invalid_statement_row_id");
    date(row.date);
    check(row.currency === input.currency, "mixed_statement_currency");
    check(["deposit", "withdrawal", "buy_settlement", "sell_settlement", "security_delivery"].includes(row.kind), "invalid_statement_kind");
    const value = amount(row.amount, row.currency);
    amount(row.balance, row.currency);
    check(Array.isArray(row.evidence) && row.evidence.length > 0 && row.evidence.every(ref => typeof ref === "string" && ref.length > 0), "statement_evidence_missing");
    check(row.kind === "security_delivery" ? value.compare(0) === 0 : value.compare(0) > 0, "invalid_statement_cash_leg");
    const previous = unique.get(row.id);
    if (previous) {
      check(identity(previous) === identity(row), "statement_duplicate_conflict");
      previous.evidence = [...new Set([...previous.evidence, ...row.evidence])];
      duplicateRows++;
    } else unique.set(row.id, structuredClone(row));
  }
  const rows = [...unique.values()];
  check(rows.every((row, index) => index === 0 || rows[index - 1].date <= row.date), "statement_order_invalid");
  const cashRows = rows.filter(row => row.kind !== "security_delivery");
  check(cashRows.length > 0, "statement_cash_missing");
  const delta = (row: BrokerCashRow) => amount(row.amount, row.currency).mul(row.kind === "withdrawal" || row.kind === "buy_settlement" ? -1 : 1);
  const opening = amount(cashRows[0].balance, input.currency).sub(delta(cashRows[0]));
  check(opening.compare(0) >= 0, "statement_negative_opening");
  let current = opening;
  let external = Decimal.from(0), trade = Decimal.from(0);
  const daily: Record<string, { closing: string; externalNet: string; tradeNet: string }> = {};
  for (const row of cashRows) {
    const movement = delta(row);
    current = current.add(movement);
    check(current.compare(0) >= 0 && current.compare(amount(row.balance, input.currency)) === 0, "statement_balance_break");
    const isExternal = row.kind === "deposit" || row.kind === "withdrawal";
    if (isExternal) external = external.add(movement); else trade = trade.add(movement);
    const day = daily[row.date] ?? { closing: "0", externalNet: "0", tradeNet: "0" };
    day.closing = current.toExactString();
    const key = isExternal ? "externalNet" : "tradeNet";
    day[key] = Decimal.from(day[key]).add(movement).toExactString();
    daily[row.date] = day;
  }
  check(current.compare(closing) === 0, "statement_closing_mismatch");
  const usedRows = new Set<string>(), usedTrades = new Set<string>();
  const matched = input.links.map(link => {
    check(typeof link.tradeId === "string" && link.tradeId.length > 0 && typeof link.ticker === "string" && link.ticker.length > 0, "invalid_trade_identity");
    check(link.confirmed === true, "trade_link_unconfirmed");
    check(link.side === "buy" || link.side === "sell", "invalid_trade_side");
    check(typeof link.quantity === "string" && /^\d+(?:\.\d{1,6})?$/.test(link.quantity) && Decimal.from(link.quantity).compare(0) > 0, "invalid_trade_quantity");
    check(!usedRows.has(link.rowId) && !usedTrades.has(link.tradeId), "trade_link_duplicate");
    usedRows.add(link.rowId); usedTrades.add(link.tradeId);
    const row = unique.get(link.rowId);
    check(row && row.kind === `${link.side}_settlement`, "trade_link_side_mismatch");
    date(link.tradeDate);
    check(link.tradeDate <= row.date, "settlement_precedes_trade");
    for (const evidence of [link.executionGross, link.originalDisplay]) if (evidence) {
      check(isCurrency(evidence.currency), "invalid_trade_money_currency");
      check(amount(evidence.amount, evidence.currency).compare(0) > 0, "invalid_trade_money");
    }
    // Merely a discrepancy: this is not evidence of fee versus tax, or an FX rate.
    const difference = link.executionGross?.currency === row.currency
      ? (link.side === "buy" ? Decimal.from(row.amount).sub(link.executionGross.amount) : Decimal.from(link.executionGross.amount).sub(row.amount)).toExactString()
      : null;
    return { ...structuredClone(link), settlementDate: row.date, cashSettlement: { amount: row.amount, currency: row.currency }, delayed: link.tradeDate !== row.date, grossToNetDifference: difference, chargeClassification: "unconfirmed" as const };
  });
  return {
    version: 1, currency: input.currency,
    opening: { amount: opening.toExactString(), basis: "derived_before_first_cash_row" as const, beforeDate: cashRows[0].date, beforeRowId: cashRows[0].id },
    closing: current.toExactString(), externalNet: external.toExactString(), tradeNet: trade.toExactString(),
    uniqueRows: rows, duplicateRows, cashRowCount: cashRows.length,
    securityRowsIgnored: rows.length - cashRows.length, daily, matched,
    unlinkedTradeRows: cashRows.filter(row => ["buy_settlement", "sell_settlement"].includes(row.kind) && !usedRows.has(row.id)).map(row => row.id),
    // Cash reconciliation alone does not authorize or certify a native replay.
    nativeReplayReady: false as const,
  };
}
