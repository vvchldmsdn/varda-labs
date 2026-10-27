export const LATEST_CLOSE_REFRESH_POLICY = Object.freeze({
  freshnessMilliseconds: 60 * 60 * 1000,
  jobType: "latest_close_revalidation",
} as const);

/** A successful exact close or a successful no-exact-date reply is shared across users. */
export function latestCloseNeedsRevalidation({ now, closeFetchedAt, completedAt }: {
  now: Date;
  closeFetchedAt: Date | string | null;
  completedAt: Date | string | null;
}) {
  return ![closeFetchedAt, completedAt].some(value => {
    if (value === null) return false;
    const observedAt = value instanceof Date ? value.getTime() : Date.parse(value);
    const age = now.getTime() - observedAt;
    return Number.isFinite(age) && age >= 0 && age < LATEST_CLOSE_REFRESH_POLICY.freshnessMilliseconds;
  });
}
