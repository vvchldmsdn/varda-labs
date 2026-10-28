import type { BetaView } from "./read-contract";
export const driftNumber = (value: number | null | undefined, digits = 1) =>
  value == null
    ? "—"
    : value === 0
      ? (0).toFixed(digits)
      : (value > 0 ? "+" : "") +
        (Math.abs(value) < 10 ** -digits ? value.toPrecision(2) : value.toFixed(digits));
export function targetMessage(view: BetaView) {
  return (
    view.domain?.planning?.targets.message ??
    (view.domain?.state === "loading" ? "목표 읽는 중" : "목표 근거 확인 전")
  );
}
