import {
  accountsForPortfolioScope,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export type InvestmentLabSnapshotFxRow = Readonly<{
  account: string;
  usdKrw: string | number | null;
  source: string | null;
  ruleVersion: string | null;
}>;

export type InvestmentLabSnapshotFxBlocker =
  | "missing_snapshot_fx"
  | "ambiguous_snapshot_fx"
  | "missing_snapshot_fx_provenance"
  | "ambiguous_snapshot_fx_provenance";

export function resolveInvestmentLabSnapshotFx(
  rows: readonly InvestmentLabSnapshotFxRow[],
  account: PortfolioAccountScope = "all",
) {
  const trackedAccounts = accountsForPortfolioScope(account);
  const blockers = new Set<InvestmentLabSnapshotFxBlocker>();
  const namedRates: number[] = [];
  const namedSources: string[] = [];
  const namedRules: string[] = [];
  let missing = false;

  for (const trackedAccount of trackedAccounts) {
    const matches = rows.filter(
      (row) => String(row.account).trim().toLowerCase() === trackedAccount,
    );
    if (matches.length !== 1) {
      missing = true;
      continue;
    }
    const rate = positiveNumber(matches[0].usdKrw);
    if (rate === null) missing = true;
    else namedRates.push(rate);
    const source = nonEmptyString(matches[0].source);
    const rule = nonEmptyString(matches[0].ruleVersion);
    if (!source || !rule) {
      blockers.add("missing_snapshot_fx_provenance");
    } else {
      namedSources.push(source);
      namedRules.push(rule);
    }
  }

  if (missing || namedRates.length !== trackedAccounts.length) {
    blockers.add("missing_snapshot_fx");
    return result(null, false, blockers);
  }
  if (namedRates.some((rate) => !sameNumber(rate, namedRates[0]))) {
    blockers.add("ambiguous_snapshot_fx");
    return result(null, false, blockers);
  }
  if (
    namedSources.length !== trackedAccounts.length ||
    namedRules.length !== trackedAccounts.length
  ) {
    return result(namedRates[0], false, blockers);
  }
  if (
    namedSources.some((source) => source !== namedSources[0]) ||
    namedRules.some((rule) => rule !== namedRules[0])
  ) {
    blockers.add("ambiguous_snapshot_fx_provenance");
    return result(namedRates[0], false, blockers);
  }

  const allRows =
    account === "all"
      ? rows.filter(
          (row) => String(row.account).trim().toLowerCase() === "all",
        )
      : [];
  if (allRows.length > 1) {
    blockers.add("ambiguous_snapshot_fx");
    return result(null, false, blockers);
  }
  if (allRows.length === 1) {
    const allRate = positiveNumber(allRows[0].usdKrw);
    if (!sameNumber(allRate, namedRates[0])) {
      blockers.add("ambiguous_snapshot_fx");
      return result(null, false, blockers);
    }
    if (
      nonEmptyString(allRows[0].source) !== namedSources[0] ||
      nonEmptyString(allRows[0].ruleVersion) !== namedRules[0]
    ) {
      blockers.add("ambiguous_snapshot_fx_provenance");
      return result(namedRates[0], false, blockers);
    }
  }

  return result(namedRates[0], true, blockers);
}

function result(
  rate: number | null,
  provenanceReady: boolean,
  blockers: Set<InvestmentLabSnapshotFxBlocker>,
) {
  return Object.freeze({
    rate,
    provenanceReady,
    blockers: Object.freeze([...blockers].sort()),
  });
}

function positiveNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonEmptyString(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function sameNumber(left: number | null, right: number | null) {
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= Math.max(1, Math.abs(left)) * 1e-10;
}
