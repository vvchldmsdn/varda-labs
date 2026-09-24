import type { TrackedPortfolioEvidence } from "./currency-tracked-portfolio.ts";
/** Explicit development fixture, never substituted for an owned portfolio. */
export function trackedCurrencyFixture(): TrackedPortfolioEvidence {
  const ownerId = "synthetic-only", before = "2026-09-01T00:00:00Z", after = "2026-09-02T00:00:00Z";
  const frame = (at: string, price: string) => ({ at, source: "synthetic_fixture", scopeComplete: true, positions: [{ id: "example", ownerId, name: "Example US asset", observation: { quantity: "1", price, currency: "USD" as const, at, basis: "raw" as const, source: "synthetic_fixture" }, cost: { amount: "1000", currency: "USD" as const, at: before, source: "synthetic_fixture" } }] });
  return { ownerId, reporting: "USD", asOf: after, current: frame(after, "1100"), history: [frame(before, "1000")], trades: [],
    fx: [{ base: "USD", quote: "KRW", rate: "1400", observedAt: before, fetchedAt: before, kind: "daily_reference", source: "synthetic_fixture" }, { base: "USD", quote: "KRW", rate: "1260", observedAt: after, fetchedAt: after, kind: "daily_reference", source: "synthetic_fixture" }], maxFxAgeMs: 0, maxPriceAgeMs: 0 };
}
