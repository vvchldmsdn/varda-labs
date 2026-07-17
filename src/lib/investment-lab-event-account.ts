import { portfolioEventAccountFromMetadata } from "./portfolio-return-metrics-core.ts";
import {
  isNamedPortfolioAccount,
  type NamedPortfolioAccount,
} from "./portfolio-account-scope.ts";

export type InvestmentLabEventAccountSource =
  | "event_metadata"
  | "current_asset"
  | "historical_position_consensus"
  | "unresolved";

export type InvestmentLabHistoricalPositionAccountRow = Readonly<{
  legacyAssetId: string | null;
  account: string | null;
}>;

export function buildInvestmentLabHistoricalAccountConsensus(
  rows: readonly InvestmentLabHistoricalPositionAccountRow[],
) {
  const candidates = new Map<string, Set<string>>();
  for (const row of rows) {
    const legacyAssetId = normalizeText(row.legacyAssetId);
    if (!legacyAssetId) continue;
    const accounts = candidates.get(legacyAssetId) ?? new Set<string>();
    accounts.add(normalizeText(row.account)?.toLowerCase() ?? "__invalid__");
    candidates.set(legacyAssetId, accounts);
  }

  const consensus = new Map<string, NamedPortfolioAccount>();
  for (const [legacyAssetId, accounts] of candidates) {
    if (accounts.size !== 1) continue;
    const account = [...accounts][0];
    if (isNamedPortfolioAccount(account)) {
      consensus.set(legacyAssetId, account);
    }
  }
  return consensus as ReadonlyMap<string, NamedPortfolioAccount>;
}

export function resolveInvestmentLabEventAccount(
  input: Readonly<{
    account: string | null;
    beforeValue: unknown;
    afterValue: unknown;
    assetAccount: string | null;
    legacyAssetId: string | null;
  }>,
  historicalConsensus: ReadonlyMap<string, NamedPortfolioAccount>,
): Readonly<{
  account: NamedPortfolioAccount | null;
  source: InvestmentLabEventAccountSource;
}> {
  const eventAccount = normalizeNamedAccount(
    portfolioEventAccountFromMetadata({
      account: input.account,
      beforeValue: input.beforeValue,
      afterValue: input.afterValue,
    }),
  );
  if (eventAccount) return result(eventAccount, "event_metadata");

  const assetAccount = normalizeNamedAccount(input.assetAccount);
  if (assetAccount) return result(assetAccount, "current_asset");

  const legacyAssetId = normalizeText(input.legacyAssetId);
  const historicalAccount = legacyAssetId
    ? (historicalConsensus.get(legacyAssetId) ?? null)
    : null;
  return historicalAccount
    ? result(historicalAccount, "historical_position_consensus")
    : result(null, "unresolved");
}

function normalizeNamedAccount(value: unknown) {
  const normalized = normalizeText(value)?.toLowerCase() ?? "";
  return isNamedPortfolioAccount(normalized) ? normalized : null;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function result(
  account: NamedPortfolioAccount | null,
  source: InvestmentLabEventAccountSource,
) {
  return Object.freeze({ account, source });
}
