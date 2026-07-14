export function formatSimulationDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}

export function formatSignedReturn(value: number) {
  const percentage = value * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(2)}%`;
}

export function formatAxisReturn(value: number) {
  const percentage = value * 100;
  if (Math.abs(percentage) < 0.0001) return "0%";
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(2)}%`;
}

export function formatReturnRange(scale: number) {
  return `${formatAxisReturn(-scale)} ~ ${formatAxisReturn(scale)}`;
}

export function formatIndexValue(value: number) {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
