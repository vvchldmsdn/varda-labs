import {
  prepareCanonicalMigrationShadowOwner,
  shadowFingerprint,
} from "./migration-canonical-owner-shadow.mjs";
import {
  HistoryImportArgumentError,
  parseBase44HistoryArgs,
} from "./base44-history-canonical-args.mjs";
import { buildSharedFxDiagnostic } from "./base44-history-fx-diagnostic.mjs";
import { planHistorySnapshots } from "./base44-history-snapshot-plan.mjs";

export { HistoryImportArgumentError, parseBase44HistoryArgs };

export function buildBase44HistoryCanonicalPlan({
  canonicalOwnerId,
  approveProvisioningOwner,
  legacyOwnerUserId,
  appUser,
  source,
  state,
  coreProof,
}) {
  assertPlanInputs(source, state);
  const ownerPreparation = prepareCanonicalMigrationShadowOwner({
    canonicalOwnerId,
    approveProvisioningOwner,
    legacyOwnerUserId,
    appUser,
  });
  const globalReasons = [...ownerPreparation.blockers];
  const coreProofState = normalizeCoreProof(coreProof);
  const snapshots = planHistorySnapshots({
    source,
    state,
    canonicalOwnerId,
    globalBlock: globalReasons.length > 0,
    coreProofState,
  });
  const sharedFx = buildSharedFxDiagnostic(source.fxRates, state.fxRates);
  const result =
    globalReasons.length === 0 && snapshots.actions.block === 0
      ? "planned"
      : "blocked";

  return Object.freeze({
    operation: "base44_history_canonical_owner",
    phase: "1E-D",
    mode: "shadow",
    source: "migration_cli",
    result,
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled:
      ownerPreparation.context?.tenantWriteContext.writesCanonicalOwner ===
      true,
    databaseSideEffects: false,
    candidateCounts: Object.freeze({
      sourceAccountBalances: source.balances.length,
      sourcePortfolioSnapshots: source.portfolios.length,
      sourcePositionSnapshots: source.positions.length,
      databaseAccountBalances: state.balances.length,
      databasePortfolioSnapshots: state.portfolios.length,
      databasePositionSnapshots: state.positions.length,
      accounts: state.accounts.length,
      assets: state.assets.length,
    }),
    actions: snapshots.actions,
    tables: snapshots.tables,
    references: snapshots.references,
    reasonCounts: summarizeStrings([
      ...globalReasons,
      ...snapshots.reasons,
    ]),
    sharedFx,
    coreProof: Object.freeze({
      result: coreProofState.result,
      fresh: coreProofState.fresh,
      accounts: coreProofState.accountCodes.size,
      assets: coreProofState.assetLegacyIds.size,
    }),
    plannedCanonicalAssignments:
      snapshots.actions.insert + snapshots.actions.update,
    fingerprints: Object.freeze({
      owner: shadowFingerprint(canonicalOwnerId),
      snapshotSource: shadowFingerprint({
        balances: source.balances,
        portfolios: source.portfolios,
        positions: source.positions,
      }),
      sharedFxSource: shadowFingerprint(source.fxRates),
      databaseState: shadowFingerprint(state),
      coreProof: shadowFingerprint({
        result: coreProofState.result,
        fresh: coreProofState.fresh,
        accountCodes: [...coreProofState.accountCodes].sort(),
        assetLegacyIds: [...coreProofState.assetLegacyIds].sort(),
      }),
    }),
  });
}

function normalizeCoreProof(coreProof) {
  const accountCodes = new Set(coreProof?.accountCodes ?? []);
  const assetLegacyIds = new Set(coreProof?.assetLegacyIds ?? []);
  const fresh =
    coreProof?.result === "planned" &&
    coreProof?.actualWriteAllowed === false &&
    coreProof?.canonicalOwnerWriteEnabled === false &&
    coreProof?.databaseSideEffects === false;
  return {
    result: coreProof?.result ?? "unavailable",
    fresh,
    accountCodes,
    assetLegacyIds,
  };
}

function summarizeStrings(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.freeze(
    Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

function assertPlanInputs(source, state) {
  for (const key of ["balances", "portfolios", "positions", "fxRates"]) {
    if (!Array.isArray(source?.[key])) {
      throw new HistoryImportArgumentError("invalid_history_source_state");
    }
  }
  for (const key of [
    "balances",
    "portfolios",
    "positions",
    "fxRates",
    "accounts",
    "assets",
  ]) {
    if (!Array.isArray(state?.[key])) {
      throw new HistoryImportArgumentError("invalid_history_database_state");
    }
  }
}
