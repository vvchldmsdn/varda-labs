import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";
import { closeCalendarReferenceDateForAsset } from "./snapshots/market-calendar.ts";

export const KRX_GOLD_CLOSE_CYCLE_POLICY = Object.freeze({
  version: "krx_gold_close_cycle_v1",
  cutoff: "07:00_KST",
  snapshotDateMeaning: "service_cycle_end_date",
  expectedCloseDate:
    "previous_krx_trading_day_on_or_before_snapshot_date_minus_one",
  firstEligibleServiceDate: "close_date_plus_one_calendar_day",
  nonTradingCycle: "carry_observation_without_synthetic_copy",
} as const);

export type KrxGoldCloseCycleResolution = Readonly<{
  status: "usable" | "unavailable";
  reason:
    | "first_eligible_cycle"
    | "non_trading_cycle_carry"
    | "invalid_snapshot_date"
    | "invalid_price_date"
    | "future_close"
    | "stale_close";
  snapshotDate: string | null;
  expectedCloseDate: string | null;
  observationDate: string | null;
  firstEligibleServiceDate: string | null;
  carryCalendarDays: number | null;
  createsSyntheticObservation: false;
}>;

type KrxGoldCloseCycleUnavailableReason = Exclude<
  KrxGoldCloseCycleResolution["reason"],
  "first_eligible_cycle" | "non_trading_cycle_carry"
>;

const KRX_GOLD_MARKET = Object.freeze({
  market: "korea",
  currency: "KRW",
});

export function resolveKrxGoldCloseCycle(input: Readonly<{
  snapshotDate: string;
  priceDate: string;
}>): KrxGoldCloseCycleResolution {
  if (!isRiskDate(input.snapshotDate)) {
    return unavailable("invalid_snapshot_date");
  }

  const expectedCloseDate = closeCalendarReferenceDateForAsset(
    KRX_GOLD_MARKET,
    input.snapshotDate,
  );
  if (!isRiskDate(input.priceDate)) {
    return unavailable(
      "invalid_price_date",
      input.snapshotDate,
      expectedCloseDate,
    );
  }

  const firstEligibleServiceDate = mapRiskEvidenceDateToServiceDate(
    input.priceDate,
  );
  if (input.priceDate > expectedCloseDate) {
    return unavailable(
      "future_close",
      input.snapshotDate,
      expectedCloseDate,
      input.priceDate,
      firstEligibleServiceDate,
    );
  }
  if (input.priceDate < expectedCloseDate) {
    return unavailable(
      "stale_close",
      input.snapshotDate,
      expectedCloseDate,
      input.priceDate,
      firstEligibleServiceDate,
    );
  }

  const carryCalendarDays = riskCalendarDayDistance(
    firstEligibleServiceDate,
    input.snapshotDate,
  );
  return Object.freeze({
    status: "usable",
    reason:
      carryCalendarDays === 0
        ? "first_eligible_cycle"
        : "non_trading_cycle_carry",
    snapshotDate: input.snapshotDate,
    expectedCloseDate,
    observationDate: input.priceDate,
    firstEligibleServiceDate,
    carryCalendarDays,
    createsSyntheticObservation: false,
  });
}

function unavailable(
  reason: KrxGoldCloseCycleUnavailableReason,
  snapshotDate: string | null = null,
  expectedCloseDate: string | null = null,
  observationDate: string | null = null,
  firstEligibleServiceDate: string | null = null,
): KrxGoldCloseCycleResolution {
  return Object.freeze({
    status: "unavailable",
    reason,
    snapshotDate,
    expectedCloseDate,
    observationDate,
    firstEligibleServiceDate,
    carryCalendarDays: null,
    createsSyntheticObservation: false,
  });
}
