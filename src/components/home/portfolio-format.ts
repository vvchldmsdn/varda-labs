export function formatKrw(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatSignedKrw(value: number | null) {
  if (value === null) return "-";
  const cleanValue = Math.abs(value) < 0.5 ? 0 : value;
  const formatted = formatKrw(Math.abs(cleanValue));
  if (cleanValue > 0) return `+${formatted}`;
  if (cleanValue < 0) return `-${formatted}`;
  return formatted;
}

export function formatPercent(value: number | null, signed = false) {
  if (value === null) return "-";
  const cleanValue = Math.abs(value) < 0.005 ? 0 : value;
  const prefix = signed && cleanValue > 0 ? "+" : "";
  return `${prefix}${cleanValue.toFixed(2)}%`;
}

export function formatDate(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 10).replaceAll("-", ".");
}

export function formatShortDate(value: string) {
  const [, month = "", day = ""] = value.split("-");
  return `${month}.${day}`;
}

export function formatKstTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function valueTone(value: number | null) {
  if (value === null || Math.abs(value) < 0.005) return "neutral" as const;
  return value > 0 ? "positive" as const : "negative" as const;
}

export function toneClass(value: number | null) {
  const tone = valueTone(value);
  if (tone === "positive") return "text-[#347e62]";
  if (tone === "negative") return "text-[#c8544f]";
  return "text-[#252824]";
}
