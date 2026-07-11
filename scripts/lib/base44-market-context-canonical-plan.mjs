import {
  prepareCanonicalMigrationShadowOwner,
  shadowFingerprint,
} from "./migration-canonical-owner-shadow.mjs";
import {
  MarketContextImportArgumentError,
  parseBase44MarketContextArgs,
} from "./base44-market-context-canonical-args.mjs";
import { buildGlobalFactorDiagnostic } from "./base44-global-factor-diagnostic.mjs";
import { buildMarketRegimeOwnerPlan } from "./base44-market-regime-owner-plan.mjs";

export { MarketContextImportArgumentError, parseBase44MarketContextArgs };

export function buildBase44MarketContextCanonicalPlan({
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
  const coreProofState = normalizeCoreProof(coreProof);
  const marketRegimeOwnerPlan = buildMarketRegimeOwnerPlan({
    sourceRows: source.marketRegimes,
    databaseRows: state.marketRegimes,
    accounts: state.accounts,
    canonicalOwnerId,
    globalBlock: ownerPreparation.blockers.length > 0,
    coreProofState,
  });
  const globalFactorDiagnostic = buildGlobalFactorDiagnostic(
    source.globalFactors,
    state.globalFactors,
  );

  return Object.freeze({
    operation: "base44_market_context_canonical_owner",
    phase: "1E-E",
    mode: "shadow",
    source: "migration_cli",
    result: marketRegimeOwnerPlan.result,
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled:
      ownerPreparation.context?.tenantWriteContext.writesCanonicalOwner ===
      true,
    databaseSideEffects: false,
    candidateCounts: Object.freeze({
      sourceMarketRegimes: source.marketRegimes.length,
      databaseMarketRegimes: state.marketRegimes.length,
      sourceGlobalFactors: source.globalFactors.length,
      databaseGlobalFactors: state.globalFactors.length,
      accounts: state.accounts.length,
    }),
    marketRegimeOwnerPlan,
    globalFactorDiagnostic,
    coreProof: Object.freeze({
      result: coreProofState.result,
      fresh: coreProofState.fresh,
      accounts: coreProofState.accountCodes.size,
    }),
    blockers: Object.freeze(ownerPreparation.blockers),
    fingerprints: Object.freeze({
      owner: shadowFingerprint(canonicalOwnerId),
      regimeSource: shadowFingerprint(source.marketRegimes),
      factorSource: shadowFingerprint(source.globalFactors),
      databaseState: shadowFingerprint(state),
      coreProof: shadowFingerprint({
        result: coreProofState.result,
        fresh: coreProofState.fresh,
        accountCodes: [...coreProofState.accountCodes].sort(),
      }),
    }),
  });
}

function normalizeCoreProof(coreProof) {
  const accountCodes = new Set(coreProof?.accountCodes ?? []);
  const fresh =
    coreProof?.result === "planned" &&
    coreProof?.actualWriteAllowed === false &&
    coreProof?.canonicalOwnerWriteEnabled === false &&
    coreProof?.databaseSideEffects === false;
  return {
    result: coreProof?.result ?? "unavailable",
    fresh,
    accountCodes,
  };
}

function assertPlanInputs(source, state) {
  for (const key of ["marketRegimes", "globalFactors"]) {
    if (!Array.isArray(source?.[key])) {
      throw new MarketContextImportArgumentError(
        "invalid_market_context_source_state",
      );
    }
  }
  for (const key of ["marketRegimes", "globalFactors", "accounts"]) {
    if (!Array.isArray(state?.[key])) {
      throw new MarketContextImportArgumentError(
        "invalid_market_context_database_state",
      );
    }
  }
}
