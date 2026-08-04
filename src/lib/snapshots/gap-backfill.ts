const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const SNAPSHOT_GAP_BACKFILL_POLICY = Object.freeze({
  id: "unchanged_holdings_snapshot_gap_v1",
  maximumCalendarDays: 45,
  holdingsAttestation: "operator_confirmed_unchanged",
  eventLedgerRequirement: "no_events_in_range",
  writeMode: "insert_only",
  fxAsOf: "previous_calendar_date",
  manualValuation: "latest_prior_generated_snapshot_carry",
  ruleVersion: "varda-daily-snapshot-gap-backfill-v1",
} as const);

export type SnapshotGapBackfillAuthorization = Readonly<{
  policyId: typeof SNAPSHOT_GAP_BACKFILL_POLICY.id;
  fromDate: string;
  toDate: string;
  ownerUserId: string;
  holdingsAttestation: typeof SNAPSHOT_GAP_BACKFILL_POLICY.holdingsAttestation;
  eventLedgerMutationCount: 0;
}>;

export type SnapshotGapBackfillValidation =
  | Readonly<{ ok: true; dates: readonly string[] }>
  | Readonly<{ ok: false; reason: string }>;

export function validateSnapshotGapBackfillAuthorization(input: Readonly<{
  authorization: SnapshotGapBackfillAuthorization;
  requestedDate: string;
  requestedOwnerUserId: string;
  currentCycleDate: string;
}>): SnapshotGapBackfillValidation {
  const { authorization } = input;
  if (authorization.policyId !== SNAPSHOT_GAP_BACKFILL_POLICY.id) {
    return blocked("unsupported_backfill_policy");
  }
  if (
    authorization.holdingsAttestation !==
    SNAPSHOT_GAP_BACKFILL_POLICY.holdingsAttestation
  ) {
    return blocked("unchanged_holdings_not_attested");
  }
  if (authorization.eventLedgerMutationCount !== 0) {
    return blocked("event_ledger_mutations_present");
  }
  if (authorization.ownerUserId !== input.requestedOwnerUserId) {
    return blocked("owner_mismatch");
  }

  const range = buildInclusiveDateRange(
    authorization.fromDate,
    authorization.toDate,
  );
  if (!range.ok) return range;
  if (!range.dates.includes(input.requestedDate)) {
    return blocked("requested_date_outside_approved_range");
  }
  if (input.requestedDate >= input.currentCycleDate) {
    return blocked("backfill_date_not_before_current_cycle");
  }
  return range;
}

export function buildInclusiveDateRange(
  fromDate: string,
  toDate: string,
): SnapshotGapBackfillValidation {
  if (!isDateKey(fromDate) || !isDateKey(toDate) || fromDate > toDate) {
    return blocked("invalid_backfill_date_range");
  }

  const dates: string[] = [];
  let current = fromDate;
  while (current <= toDate) {
    dates.push(current);
    if (dates.length > SNAPSHOT_GAP_BACKFILL_POLICY.maximumCalendarDays) {
      return blocked("backfill_date_range_too_large");
    }
    current = shiftDate(current, 1);
  }
  return Object.freeze({ ok: true, dates: Object.freeze(dates) });
}

export function previousCalendarDate(date: string) {
  if (!isDateKey(date)) throw new Error("date must be YYYY-MM-DD");
  return shiftDate(date, -1);
}

function blocked(reason: string): SnapshotGapBackfillValidation {
  return Object.freeze({ ok: false, reason });
}

function isDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function shiftDate(date: string, deltaDays: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}
