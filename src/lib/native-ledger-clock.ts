export type NativeLedgerClock = { serverMs: number; receivedAt: number };

/** Start at response receipt, without adding guessed network latency. This keeps
 * the default at or behind the observed server clock, independent of device time.
 * The authenticated writer remains the authority and still rejects future dates.
 */
export function observeNativeLedgerClock(serverNow: unknown, receivedAt = performance.now()): NativeLedgerClock {
  const serverMs = typeof serverNow === "string" ? Date.parse(serverNow) : NaN;
  if (!Number.isFinite(serverMs) || !Number.isFinite(receivedAt)) throw new Error("unavailable");
  return { serverMs, receivedAt };
}

export function nativeLedgerNow(clock: NativeLedgerClock | null, monotonicNow = performance.now()): number {
  if (!clock || !Number.isFinite(monotonicNow)) throw new Error("unavailable");
  return Math.floor(clock.serverMs + Math.max(0, monotonicNow - clock.receivedAt));
}

/** datetime-local stays in the user's time zone; only the clock source changes. */
export function nativeLedgerLocalTime(nowMs: number): string {
  const now = new Date(nowMs);
  return new Date(nowMs - now.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}
