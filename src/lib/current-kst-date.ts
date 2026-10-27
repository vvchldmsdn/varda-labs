/** The calendar date shown to users, independent of the 07:00 snapshot writer cutoff. */
export function currentKstDate(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
