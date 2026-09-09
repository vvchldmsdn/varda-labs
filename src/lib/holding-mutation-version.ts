/** Preserve PostgreSQL microseconds across the form boundary for exact optimistic locking. */
export function isHoldingMutationVersion(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Three digits keep already-open forms compatible; database reads always emit six.
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(?:\d{3}|\d{6})Z$/.exec(value);
  if (!match) return false;
  const seconds = `${match[1]}.000Z`;
  const parsed = new Date(seconds);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === seconds;
}
