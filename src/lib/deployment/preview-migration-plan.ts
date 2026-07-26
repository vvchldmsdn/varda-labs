import {
  planReviewedMigrations,
  type AppliedMigrationEvidence,
  type LocalMigrationEvidence,
  type ReviewedMigrationPlan,
} from "./migration-ledger-plan.ts";

export type {
  AppliedMigrationEvidence,
  LocalMigrationEvidence,
} from "./migration-ledger-plan.ts";

export type PreviewMigrationPlan = ReviewedMigrationPlan;

export function planPreviewMigrations(input: {
  localMigrations: readonly LocalMigrationEvidence[];
  appliedMigrations: readonly AppliedMigrationEvidence[];
  allowedPendingMigrations: readonly LocalMigrationEvidence[];
}): PreviewMigrationPlan {
  return planReviewedMigrations(input);
}
