export const APPROVED_HISTORY_MANIFEST_ARTIFACT_COMMIT =
  "689abe0fb69e04a562843b7eb69de65668723490";

export const approvedPortfolioBrokerageObservedManifest = Object.freeze({
  manifestVersion: "portfolio-brokerage-observed-v1",
  sourceAuthority: "stored_daily_portfolio_snapshots_display_evidence_v1",
  lane: "portfolio",
  account: "brokerage",
  mode: "observed_only",
  validationEvidence: Object.freeze([
    "repository_data_integrity_audit_2026-07-12T00:47:06.560Z",
    "portfolio_named_account_source_summary_read_2026-07-12",
  ]),
});

export function manifest(overrides = {}) {
  return {
    ...approvedPortfolioBrokerageObservedManifest,
    validationEvidence: [
      ...approvedPortfolioBrokerageObservedManifest.validationEvidence,
    ],
    ...overrides,
  };
}
