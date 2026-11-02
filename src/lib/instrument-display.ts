/** Presentation only: never use this label as an instrument, ledger or cache key. */
export function instrumentLabel(instrument: { name?: string | null; ticker?: string | null; market?: string | null }) {
  const name = instrument.name?.trim();
  const ticker = instrument.ticker?.trim();
  if (instrument.market?.trim().toLowerCase() === "us") return ticker || name || "종목 확인 필요";
  return name || ticker || "종목 확인 필요";
}
