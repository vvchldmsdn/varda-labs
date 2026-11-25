import { Decimal } from "./money.ts";

/** A null field means the broker supplied no figure for this market/month. */
export type BrokerRealizedMonth = {
  month: string;
  domesticKrw: string | null;
  overseasUsd: string | null;
  overseasBrokerKrw: string | null;
};

export type BrokerRealizedStatement = Omit<BrokerRealizedMonth, "month"> & {
  accountLabel: string;
  startDate: string;
  endDate: string;
  months: BrokerRealizedMonth[];
  subtotalKrw: string | null;
};

function sumConfirmed(amounts: (string | null)[]) {
  const confirmed = amounts.filter((n): n is string => n !== null);
  return confirmed.length ? confirmed.reduce((total, value) => total.add(value), Decimal.from(0)).toExactString() : null;
}

const krw = /^-?\d{1,20}$/;
const usd = /^-?\d{1,20}(?:\.\d{1,2})?$/;
const amountMatches = (value: unknown, format: RegExp) => value === null || typeof value === "string" && format.test(value);

export function projectBrokerRealizedStatement(row: Readonly<Record<string, unknown>>): BrokerRealizedStatement | null {
  const { start_date: startDate, end_date: endDate, account_label: accountLabel } = row;
  if (typeof accountLabel !== "string" || !accountLabel.trim() || typeof startDate !== "string" ||
      typeof endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate || !Array.isArray(row.months) ||
      !row.months.length || row.months.length > 1200) return null;
  const months: BrokerRealizedMonth[] = [];
  const firstMonth = Number(startDate.slice(0, 4)) * 12 + Number(startDate.slice(5, 7)) - 1;
  for (const item of row.months) {
    const n = firstMonth + months.length;
    const expected = String(Math.floor(n / 12)).padStart(4, "0") + "-" + String(n % 12 + 1).padStart(2, "0");
    if (!item || item.month !== expected || !amountMatches(item.domesticKrw, krw) ||
        !amountMatches(item.overseasUsd, usd) || !amountMatches(item.overseasBrokerKrw, krw)) return null;
    months.push({ month: expected, domesticKrw: item.domesticKrw, overseasUsd: item.overseasUsd,
      overseasBrokerKrw: item.overseasBrokerKrw });
  }
  if (months[months.length - 1].month !== endDate.slice(0, 7)) return null;
  const domesticKrw = sumConfirmed(months.map(item => item.domesticKrw));
  const overseasUsd = sumConfirmed(months.map(item => item.overseasUsd));
  const overseasBrokerKrw = sumConfirmed(months.map(item => item.overseasBrokerKrw));
  return { accountLabel, startDate, endDate, months, domesticKrw, overseasUsd, overseasBrokerKrw,
    subtotalKrw: sumConfirmed([domesticKrw, overseasBrokerKrw]) };
}
