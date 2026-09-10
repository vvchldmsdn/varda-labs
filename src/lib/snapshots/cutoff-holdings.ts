type HoldingTimeEvidence = Readonly<{
  id: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}>;

/** Without an as-of position ledger, late writes may only use holdings that
 * are known to have stayed unchanged since the cutoff. */
export function holdingsChangedAfterCutoff(
  holdings: readonly HoldingTimeEvidence[], cutoffAt: Date,
) {
  const cutoffMs = cutoffAt.getTime();
  return holdings.filter((holding) => [holding.createdAt, holding.updatedAt].some((value) => {
    const time = new Date(value).getTime();
    return !Number.isFinite(time) || !Number.isFinite(cutoffMs) || time > cutoffMs;
  })).map((holding) => holding.id);
}

/** Ledger-only edits can change realized cost and return without touching a holding. */
export function eventsChangedAfterCutoff(
  events: readonly HoldingTimeEvidence[], cutoffAt: Date,
) {
  return holdingsChangedAfterCutoff(events, cutoffAt);
}
