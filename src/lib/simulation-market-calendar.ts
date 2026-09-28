import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";
import { closeCalendarReferenceDateForAsset } from "./snapshots/market-calendar.ts";

/** Older Korean calendars are partial. Unknown years must not imply an open session. */
export const SIMULATION_MARKET_CALENDAR = Object.freeze({
  version: "kr_us_exchange_sessions_2026_v1",
  sourceDateFrom: "2026-01-01",
  sourceDateTo: "2026-12-31",
} as const);
export function simulationExpectedCloseDate(market: string, serviceDate: string): string | null {
  if (!isRiskDate(serviceDate) || !["korea", "us"].includes(market)) return null;
  const sourceDate = shiftRiskDate(serviceDate, -1);
  if (sourceDate < SIMULATION_MARKET_CALENDAR.sourceDateFrom || sourceDate > SIMULATION_MARKET_CALENDAR.sourceDateTo) return null;
  const result = closeCalendarReferenceDateForAsset({ market, currency: market === "us" ? "USD" : "KRW" }, serviceDate);
  return result >= SIMULATION_MARKET_CALENDAR.sourceDateFrom ? result : null;
}
/** Build expected dates only, never prices. Missing open sessions remain on the axis. */
export function simulationExpectedServiceDates(markets: readonly string[], from: string, endServiceDate: string) {
  if (!isRiskDate(from) || !isRiskDate(endServiceDate) ||
    shiftRiskDate(endServiceDate,-1) > SIMULATION_MARKET_CALENDAR.sourceDateTo || !markets.length ||
    markets.some(market => !["korea", "us"].includes(market))) return Object.freeze([] as string[]);
  const dates: string[] = [];
  const supportedStart = from < SIMULATION_MARKET_CALENDAR.sourceDateFrom ? SIMULATION_MARKET_CALENDAR.sourceDateFrom : from;
  for (let sourceDate = supportedStart; sourceDate < endServiceDate; sourceDate = shiftRiskDate(sourceDate, 1)) {
    const serviceDate = shiftRiskDate(sourceDate, 1);
    if (markets.some(market => simulationExpectedCloseDate(market, serviceDate) === sourceDate)) dates.push(serviceDate);
  }
  return Object.freeze(dates);
}
