/** Keep small progress polls responsive while combining expensive page reads.
 * This state belongs to one mounted operation, never to a different account. */
export function createQuoteReadRefreshGate(intervalMilliseconds = 10_000) {
  let displayedVersion: string | undefined;
  let pendingVersion: string | undefined;
  let refreshedAt = -Infinity;
  return {
    observe(version: string | undefined) {
      if (version !== undefined) pendingVersion = version;
    },
    take(now: number, terminal = false) {
      if (pendingVersion === undefined || pendingVersion === displayedVersion) return false;
      if (!terminal && now - refreshedAt < intervalMilliseconds) return false;
      displayedVersion = pendingVersion;
      refreshedAt = now;
      return true;
    },
  };
}
