export const historicalEvidenceFixture = Object.freeze({
  observed: requirement({
    key: "069500:2026-06-30",
    evidenceKind: "observed",
    asOfDate: "2026-06-30",
    sourceDates: ["2026-06-30"],
    source: "asset_price_snapshots",
  }),
  providerBackfilled: requirement({
    key: "069500:2026-07-01",
    evidenceKind: "provider_backfilled",
    asOfDate: "2026-07-01",
    sourceDates: ["2026-07-01"],
    source: "reviewed_provider_close",
    methodVersion: "provider_close_backfill_v1",
  }),
  reconstructed: requirement({
    key: "portfolio:2026-07-01",
    evidenceKind: "reconstructed",
    asOfDate: "2026-07-01",
    sourceDates: ["2026-06-30", "2026-07-01"],
    source: "positions_events_prices_fx",
    methodVersion: "portfolio_reconstruction_fixture_v1",
  }),
  displayEstimated: requirement({
    key: "069500:2026-07-02",
    evidenceKind: "display_estimated",
    asOfDate: "2026-07-02",
    sourceDates: ["2026-07-01", "2026-07-03"],
    source: "adjacent_observations",
    methodVersion: "linear_chart_interpolation_fixture_v1",
  }),
  missing: requirement({
    key: "069500:2026-07-03",
    evidenceKind: "missing",
    asOfDate: "2026-07-03",
    reason: "provider_observation_not_found",
  }),
  ambiguous: requirement({
    key: "069500:2026-07-04",
    evidenceKind: "ambiguous",
    asOfDate: "2026-07-04",
    reason: "duplicate_source_observations",
  }),
});

export function requirement(overrides = {}) {
  return Object.freeze({
    key: "fixture:2026-07-01",
    evidenceKind: "observed",
    source: null,
    asOfDate: "2026-07-01",
    sourceDates: Object.freeze([]),
    methodVersion: null,
    reason: null,
    ...overrides,
  });
}
