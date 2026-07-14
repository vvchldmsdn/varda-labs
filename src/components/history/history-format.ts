import type {
  HistoryAccount,
  HistoryLane,
  PortfolioHistoryDisplayRow,
} from "@/lib/history-balance";

const KRW_FORMATTER = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});
const PERCENT_FORMATTER = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
});
const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 8,
});

export function historyAccountLabel(account: HistoryAccount) {
  if (account === "all") return "전체";
  if (account === "brokerage") return "증권";
  return account.toUpperCase();
}

export function historyLaneLabel(lane: HistoryLane) {
  if (lane === "all") return "전체 기록";
  if (lane === "balance") return "잔액 기록";
  if (lane === "events") return "저장 이벤트";
  return "포트폴리오 성과";
}

export function historySourceLabel(source: string) {
  if (source === "stored_balance_record") return "저장 잔액 기록";
  if (source === "base44_import") return "Base44 이관";
  if (source === "varda_manual_daily_snapshot") return "Varda 일일 저장";
  return source;
}

export function historyRowKindLabel(row: PortfolioHistoryDisplayRow) {
  if (row.rowKind === "stored") return "저장값";
  const accounts = row.derivedFromAccounts
    .map(historyAccountLabel)
    .join(", ");
  return `표시용 합산${accounts ? ` (${accounts})` : ""}`;
}

export function formatHistoryKrw(value: string | number | null) {
  if (value === null || value === "") return "n/a";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? KRW_FORMATTER.format(numeric) : "n/a";
}

export function formatHistoryPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${PERCENT_FORMATTER.format(value)}%`;
}

export function formatHistoryNumber(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "n/a"
    : NUMBER_FORMATTER.format(value);
}

export function formatHistoryDateRange(range: {
  minDate: string | null;
  maxDate: string | null;
}) {
  if (!range.minDate || !range.maxDate) return "기록 없음";
  if (range.minDate === range.maxDate) return range.minDate;
  return `${range.minDate} ~ ${range.maxDate}`;
}
