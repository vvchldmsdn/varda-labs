import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  assetPriceSnapshots,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  fxRates,
} from "@/db/schema";
import {
  loadInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadRepository,
} from "@/lib/investment-lab-counterfactual-read-loader";
import type { InvestmentLabPeriodRequest } from "@/lib/investment-lab-period-selection";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type { InvestmentLabFountRuntimeEvidence } from "@/lib/investment-lab-fount-runtime-scope";
import { INVESTMENT_LAB_FOUNT_RUNTIME_SCOPE_POLICY } from "@/lib/investment-lab-fount-runtime-scope";
import type { InvestmentLabAnalysisScopeEvidence } from "@/lib/investment-lab-analysis-scope";
import {
  DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS,
  attachBase44ImportedTickerEvidence,
} from "@/lib/investment-lab-special-holding-authority";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  accountsForPortfolioScope,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import {
  buildInvestmentLabHistoricalAccountConsensus,
  resolveInvestmentLabEventAccount,
} from "@/lib/investment-lab-event-account";
import {
  admitAdjustedHistoricalPriceRows,
  admitPrivateSingleTenantRawHistoricalPriceRows,
  selectPreferredPrivateHistoricalPriceRows,
} from "@/lib/market-data/asset-price-consumer-admission";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { getActivePortfolioOwnerUserIds } from "./active-portfolio-owners";
import { getReadOnlyTenantApprovedTargetPolicy } from "./target-policy";
import { getReadOnlyTenantTargetPolicyHoldingUniverse } from "./target-policy-holding-universe";

const LEGACY_ID_PATTERN = /^[0-9a-f]{24}$/;
type InvestmentLabFountRuntimePositionRow = Extract<
  InvestmentLabFountRuntimeEvidence,
  { status: "ready" }
>["positionRows"][number];

function createTenantInvestmentLabRepository(
  tenantContext: TenantContext,
  accountScope: PortfolioAccountScope,
  activeOwnerUserIdsPromise: Promise<readonly string[]>,
): InvestmentLabCounterfactualReadRepository {
  const selectedAccounts = [...accountsForPortfolioScope(accountScope)];
  const snapshotAccounts =
    accountScope === "irp"
      ? [...NAMED_PORTFOLIO_ACCOUNTS]
      : selectedAccounts;

  return {
  async loadApprovedTargetPolicyContext(account) {
    const [approvedPolicyRead, currentUniverse] = await Promise.all([
      getReadOnlyTenantApprovedTargetPolicy({ account, tenantContext }),
      getReadOnlyTenantTargetPolicyHoldingUniverse({
        account,
        tenantContext,
      }),
    ]);
    return Object.freeze({ approvedPolicyRead, currentUniverse });
  },

  async loadEvents() {
    const [rows, historicalPositionRows] = await Promise.all([
      db
        .select({
          account: eventLedgerEntries.account,
          beforeValue: eventLedgerEntries.beforeValue,
          afterValue: eventLedgerEntries.afterValue,
          legacyAssetId: eventLedgerEntries.legacyAssetId,
          assetName: eventLedgerEntries.assetName,
          assetAccount: assets.account,
          eventDate: eventLedgerEntries.eventDate,
          eventType: eventLedgerEntries.eventType,
          amountKrw: eventLedgerEntries.amountKrw,
          quantityDelta: eventLedgerEntries.quantityDelta,
          price: eventLedgerEntries.price,
          fxRate: eventLedgerEntries.fxRate,
          assetCurrency: assets.currency,
          correctsEventId: eventLedgerEntries.correctsEventId,
          legacyCorrectsEventId: eventLedgerEntries.legacyCorrectsEventId,
        })
        .from(eventLedgerEntries)
        .innerJoin(accounts, eq(eventLedgerEntries.accountId, accounts.id))
        .leftJoin(
          assets,
          and(
            eq(eventLedgerEntries.assetId, assets.id),
            eq(assets.accountId, accounts.id),
            eq(assets.account, accounts.code),
          ),
        )
        .where(
          and(
            ...activeOwnedAccountPredicates(tenantContext),
            inArray(accounts.code, selectedAccounts),
            eq(eventLedgerEntries.account, accounts.code),
            eq(eventLedgerEntries.isSample, false),
          ),
        )
        .orderBy(
          asc(eventLedgerEntries.eventDate),
          sql`${eventLedgerEntries.recordedAt} asc nulls last`,
          asc(eventLedgerEntries.createdAt),
          sql`${eventLedgerEntries.legacyBase44Id} asc nulls last`,
          asc(eventLedgerEntries.id),
        ),
      db
        .select({
          legacyAssetId: dailyPositionSnapshots.legacyAssetId,
          account: dailyPositionSnapshots.account,
        })
        .from(dailyPositionSnapshots)
        .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
        .where(
          and(
            ...activeOwnedAccountPredicates(tenantContext),
            inArray(accounts.code, selectedAccounts),
            eq(dailyPositionSnapshots.account, accounts.code),
            eq(dailyPositionSnapshots.isSample, false),
            isNotNull(dailyPositionSnapshots.legacyAssetId),
          ),
        )
        .groupBy(
          dailyPositionSnapshots.legacyAssetId,
          dailyPositionSnapshots.account,
        ),
    ]);
    const historicalConsensus =
      buildInvestmentLabHistoricalAccountConsensus(historicalPositionRows);

    return rows.map((row, index) => {
      const account = resolveInvestmentLabEventAccount(
        row,
        historicalConsensus,
      ).account;
      return {
        legacyAssetId: row.legacyAssetId,
        account,
        eventDate: row.eventDate,
        eventType: row.eventType,
        sequence: index + 1,
        amountKrw: row.amountKrw,
        quantityDelta: row.quantityDelta,
        price: row.price,
        fxRate: row.fxRate,
        assetCurrency: row.assetCurrency,
        isCorrection:
          row.correctsEventId !== null || row.legacyCorrectsEventId !== null,
      };
    });
  },

  async loadSnapshots() {
    return db
      .select({
        snapshotDate: dailyPortfolioSnapshots.snapshotDate,
        account: dailyPortfolioSnapshots.account,
        cashValue: dailyPortfolioSnapshots.cashValue,
        totalMarketValue: dailyPortfolioSnapshots.totalMarketValue,
        usdKrw: dailyPortfolioSnapshots.usdKrw,
        source: dailyPortfolioSnapshots.source,
        ruleVersion: dailyPortfolioSnapshots.ruleVersion,
      })
      .from(dailyPortfolioSnapshots)
      .innerJoin(accounts, eq(dailyPortfolioSnapshots.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          inArray(accounts.code, snapshotAccounts),
          eq(dailyPortfolioSnapshots.account, accounts.code),
          eq(dailyPortfolioSnapshots.isSample, false),
        ),
      )
      .orderBy(
        asc(dailyPortfolioSnapshots.snapshotDate),
        asc(dailyPortfolioSnapshots.account),
      );
  },

  async loadScenarioCloses() {
    return loadPreferredScenarioCloseRows({
      ticker: "069500",
      market: "korea",
      currency: "KRW",
      tenantContext,
      activeOwnerUserIds: await activeOwnerUserIdsPromise,
    });
  },

  async loadVooCloses() {
    return loadPrivateRawScenarioCloseRows({
      ticker: "VOO",
      market: "us",
      currency: "USD",
      tenantContext,
      activeOwnerUserIds: await activeOwnerUserIdsPromise,
    });
  },

  async loadFxRows() {
    return loadInvestmentLabFxRows();
  },

  async loadFountRuntimeEvidence(serviceDates) {
    const decision =
      DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
    const candidates = await db
      .select({ legacyAssetId: dailyPositionSnapshots.legacyAssetId })
      .from(dailyPositionSnapshots)
      .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          inArray(accounts.code, selectedAccounts),
          eq(dailyPositionSnapshots.account, accounts.code),
          eq(dailyPositionSnapshots.isSample, false),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.assetName}))`,
            decision.assetName.toLowerCase(),
          ),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.account}))`,
            decision.account,
          ),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.market}))`,
            decision.market,
          ),
          eq(
            sql<string>`upper(trim(${dailyPositionSnapshots.currency}))`,
            decision.currency,
          ),
          eq(
            sql<string>`lower(trim(coalesce(${dailyPositionSnapshots.assetType}, '')))`,
            decision.assetType,
          ),
          isNotNull(dailyPositionSnapshots.legacyAssetId),
        ),
      )
      .groupBy(dailyPositionSnapshots.legacyAssetId);
    if (candidates.length === 0) return { status: "not_applicable" } as const;
    if (candidates.length !== 1) {
      return { status: "unavailable", reason: "binding_ambiguous" } as const;
    }

    const legacyAssetId = candidates[0].legacyAssetId;
    if (
      typeof legacyAssetId !== "string" ||
      !LEGACY_ID_PATTERN.test(legacyAssetId)
    ) {
      return { status: "unavailable", reason: "binding_invalid" } as const;
    }
    const [positionRows, bindingEventRows] = await Promise.all([
      db
        .select({
          snapshotDate: dailyPositionSnapshots.snapshotDate,
          account: dailyPositionSnapshots.account,
          source: dailyPositionSnapshots.source,
          legacyAssetId: dailyPositionSnapshots.legacyAssetId,
          assetName: dailyPositionSnapshots.assetName,
          market: dailyPositionSnapshots.market,
          currency: dailyPositionSnapshots.currency,
          assetType: dailyPositionSnapshots.assetType,
          marketValueKrw: dailyPositionSnapshots.marketValueKrw,
        })
        .from(dailyPositionSnapshots)
        .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
        .where(
          and(
            ...activeOwnedAccountPredicates(tenantContext),
            inArray(accounts.code, selectedAccounts),
            eq(dailyPositionSnapshots.account, accounts.code),
            eq(dailyPositionSnapshots.isSample, false),
            eq(dailyPositionSnapshots.legacyAssetId, legacyAssetId),
          ),
        )
        .orderBy(asc(dailyPositionSnapshots.snapshotDate)),
      db
        .select({
          legacyAssetId: eventLedgerEntries.legacyAssetId,
          account: eventLedgerEntries.account,
          assetName: eventLedgerEntries.assetName,
        })
        .from(eventLedgerEntries)
        .innerJoin(accounts, eq(eventLedgerEntries.accountId, accounts.id))
        .where(
          and(
            ...activeOwnedAccountPredicates(tenantContext),
            inArray(accounts.code, selectedAccounts),
            eq(eventLedgerEntries.account, accounts.code),
            eq(eventLedgerEntries.isSample, false),
            eq(eventLedgerEntries.legacyAssetId, legacyAssetId),
          ),
        ),
    ]);
    const metadataConflict =
      positionRows.length === 0 ||
      positionRows.some(
        (row) =>
          row.legacyAssetId !== legacyAssetId ||
          normalizeText(row.assetName) !== normalizeText(decision.assetName) ||
          normalizeText(row.account) !== decision.account ||
          normalizeText(row.market) !== decision.market ||
          normalizeUpper(row.currency) !== decision.currency ||
          normalizeText(row.assetType) !== decision.assetType ||
          normalizeText(row.source) === "",
      ) ||
      bindingEventRows.some(
        (row) =>
          row.legacyAssetId !== legacyAssetId ||
          normalizeText(row.account) !== decision.account ||
          normalizeText(row.assetName) !== normalizeText(decision.assetName),
      );
    if (metadataConflict) {
      return {
        status: "unavailable",
        reason: "binding_metadata_conflict",
      } as const;
    }

    const serviceDateSet = new Set(serviceDates);
    const scopedPositionRows: InvestmentLabFountRuntimePositionRow[] = [];
    for (const row of positionRows) {
      if (!serviceDateSet.has(row.snapshotDate)) continue;
      if (row.marketValueKrw === null) {
        return {
          status: "unavailable",
          reason: "position_value_missing",
        } as const;
      }
      scopedPositionRows.push({
        snapshotDate: row.snapshotDate,
        account: row.account,
        source: row.source,
        snapshotLegacyAssetId: legacyAssetId,
        marketValueKrw: row.marketValueKrw,
      });
    }

    return {
      status: "ready",
      binding: {
        selectorBasis: "exact_snapshot_legacy_asset_id",
        snapshotLegacyAssetId: legacyAssetId,
        account: decision.account,
      },
      positionRows: scopedPositionRows,
    } as const;
  },

  async loadAnchorPositionRows(serviceDates) {
    if (serviceDates.length === 0) return [];
    const rows = await db
      .select({
        snapshotDate: dailyPositionSnapshots.snapshotDate,
        assetId: dailyPositionSnapshots.assetId,
        legacyAssetId: dailyPositionSnapshots.legacyAssetId,
        account: dailyPositionSnapshots.account,
        source: dailyPositionSnapshots.source,
        ticker: dailyPositionSnapshots.ticker,
        assetName: dailyPositionSnapshots.assetName,
        market: dailyPositionSnapshots.market,
        currency: dailyPositionSnapshots.currency,
        assetType: dailyPositionSnapshots.assetType,
        quantity: dailyPositionSnapshots.quantity,
        marketValueKrw: dailyPositionSnapshots.marketValueKrw,
        priceSource: dailyPositionSnapshots.priceSource,
        priceBasis: dailyPositionSnapshots.priceBasis,
        currentPrice: dailyPositionSnapshots.currentPrice,
        priceDate: dailyPositionSnapshots.priceDate,
        referenceDate: dailyPositionSnapshots.referenceDate,
        capturedAt: dailyPositionSnapshots.capturedAt,
        snapshotLegacyAssetId: dailyPositionSnapshots.legacyAssetId,
      })
      .from(dailyPositionSnapshots)
      .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          inArray(accounts.code, selectedAccounts),
          eq(dailyPositionSnapshots.account, accounts.code),
          eq(dailyPositionSnapshots.isSample, false),
          inArray(dailyPositionSnapshots.snapshotDate, [...serviceDates]),
        ),
      )
      .orderBy(
        asc(dailyPositionSnapshots.snapshotDate),
        asc(dailyPositionSnapshots.account),
        asc(dailyPositionSnapshots.source),
        sql`${dailyPositionSnapshots.ticker} asc nulls last`,
      );

    return attachBase44ImportedTickerEvidence(
      rows.map(({ snapshotLegacyAssetId, ...row }) => ({
        ...row,
        identityKey: snapshotLegacyAssetId,
      })),
    ).map((row) => ({
      snapshotDate: row.snapshotDate,
      assetId: row.assetId,
      legacyAssetId: row.legacyAssetId,
      account: row.account,
      source: row.source,
      ticker: row.ticker,
      assetName: row.assetName,
      market: row.market,
      currency: row.currency,
      assetType: row.assetType,
      quantity: row.quantity,
      marketValueKrw: row.marketValueKrw,
      priceSource: row.priceSource,
      priceBasis: row.priceBasis,
      currentPrice: row.currentPrice,
      priceDate: row.priceDate,
      referenceDate: row.referenceDate,
      capturedAt: row.capturedAt,
      importedTickerEvidence: row.importedTickerEvidence,
    }));
  },

  async loadAnchorPriceRows({
    instruments,
    startServiceDate,
    endServiceDate,
  }) {
    return loadInvestmentLabAnchorPriceRows({
      activeOwnerUserIds: await activeOwnerUserIdsPromise,
      endServiceDate,
      instruments,
      startServiceDate,
      tenantContext,
    });
  },
  };
}

function createTenantInvestmentLabScopeRepository(
  tenantContext: TenantContext,
  evidence: InvestmentLabAnalysisScopeEvidence,
  activeOwnerUserIdsPromise: Promise<readonly string[]>,
): InvestmentLabCounterfactualReadRepository {
  const targetPolicyRepository = evidence.supportsLegacyTargetPolicy
    ? {
        async loadApprovedTargetPolicyContext(account: (typeof NAMED_PORTFOLIO_ACCOUNTS)[number]) {
          const [approvedPolicyRead, currentUniverse] = await Promise.all([
            getReadOnlyTenantApprovedTargetPolicy({ account, tenantContext }),
            getReadOnlyTenantTargetPolicyHoldingUniverse({
              account,
              tenantContext,
            }),
          ]);
          return Object.freeze({ approvedPolicyRead, currentUniverse });
        },
      }
    : {};

  return {
    ...targetPolicyRepository,
    async loadEvents() {
      return evidence.eventRows;
    },
    async loadSnapshots() {
      return evidence.snapshotRows;
    },
    async loadScenarioCloses() {
      return loadPreferredScenarioCloseRows({
        ticker: "069500",
        market: "korea",
        currency: "KRW",
        tenantContext,
        activeOwnerUserIds: await activeOwnerUserIdsPromise,
      });
    },
    async loadVooCloses() {
      return loadPrivateRawScenarioCloseRows({
        ticker: "VOO",
        market: "us",
        currency: "USD",
        tenantContext,
        activeOwnerUserIds: await activeOwnerUserIdsPromise,
      });
    },
    async loadFxRows() {
      return loadInvestmentLabFxRows();
    },
    async loadFountRuntimeEvidence() {
      return { status: "not_applicable" } as const;
    },
    async loadAnchorPositionRows(serviceDates) {
      const serviceDateSet = new Set(serviceDates);
      return evidence.anchorPositionRows.filter((row) =>
        serviceDateSet.has(row.snapshotDate),
      );
    },
    async loadAnchorPriceRows({
      instruments,
      startServiceDate,
      endServiceDate,
    }) {
      return loadInvestmentLabAnchorPriceRows({
        activeOwnerUserIds: await activeOwnerUserIdsPromise,
        endServiceDate,
        instruments,
        startServiceDate,
        tenantContext,
      });
    },
  };
}

async function loadInvestmentLabFxRows() {
  return db
    .select({
      rateDate: fxRates.rateDate,
      usdKrw: fxRates.usdKrw,
      source: fxRates.source,
      status: fxRates.status,
    })
    .from(fxRates)
    .where(eq(fxRates.isSample, false))
    .orderBy(asc(fxRates.rateDate));
}

async function loadInvestmentLabAnchorPriceRows({
  activeOwnerUserIds,
  endServiceDate,
  instruments,
  startServiceDate,
  tenantContext,
}: {
  activeOwnerUserIds: readonly string[];
  endServiceDate: string;
  instruments: Parameters<
    InvestmentLabCounterfactualReadRepository["loadAnchorPriceRows"]
  >[0]["instruments"];
  startServiceDate: string;
  tenantContext: TenantContext;
}) {
  const tickers = [
    ...new Set(
      instruments.flatMap((row) => (row.ticker ? [row.ticker] : [])),
    ),
  ];
  if (tickers.length === 0) return [];
  const rows = await db
    .select({
      ticker: assetPriceSnapshots.ticker,
      market: assetPriceSnapshots.market,
      currency: assetPriceSnapshots.currency,
      priceDate: assetPriceSnapshots.priceDate,
      closePrice: assetPriceSnapshots.closePrice,
      adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
      adjustedCloseBasis: assetPriceSnapshots.adjustedCloseBasis,
      adjustedCloseProvider: assetPriceSnapshots.adjustedCloseProvider,
      adjustedCloseSource: assetPriceSnapshots.adjustedCloseSource,
      adjustedCloseFetchedAt: assetPriceSnapshots.adjustedCloseFetchedAt,
      providerSymbol: assetPriceSnapshots.providerSymbol,
      providerExchange: assetPriceSnapshots.providerExchange,
      fetchedAt: assetPriceSnapshots.fetchedAt,
      source: assetPriceSnapshots.source,
    })
    .from(assetPriceSnapshots)
    .where(
      and(
        eq(assetPriceSnapshots.isSample, false),
        inArray(
          sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
          tickers,
        ),
        gte(assetPriceSnapshots.priceDate, shiftIsoDate(startServiceDate, -10)),
        lte(assetPriceSnapshots.priceDate, endServiceDate),
      ),
    )
    .orderBy(
      asc(assetPriceSnapshots.priceDate),
      asc(assetPriceSnapshots.ticker),
    );

  const admission = admitPrivateSingleTenantRawHistoricalPriceRows({
    rows,
    requestedOwnerUserId: tenantContext.ownerUserId,
    activeOwnerUserIds,
  });

  return admission.rows.map((row) => ({
    ticker: row.ticker,
    market: row.market,
    currency: row.currency,
    priceDate: row.priceDate,
    closePrice: row.closePrice,
    source: row.source,
  }));
}

async function loadScenarioCloseCandidates(
  ticker: string,
  market: string,
  currency: string,
) {
  const rows = await db
    .select({
      ticker: assetPriceSnapshots.ticker,
      market: assetPriceSnapshots.market,
      currency: assetPriceSnapshots.currency,
      priceDate: assetPriceSnapshots.priceDate,
      closePrice: assetPriceSnapshots.closePrice,
      adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
      adjustedCloseBasis: assetPriceSnapshots.adjustedCloseBasis,
      adjustedCloseProvider: assetPriceSnapshots.adjustedCloseProvider,
      adjustedCloseSource: assetPriceSnapshots.adjustedCloseSource,
      adjustedCloseFetchedAt: assetPriceSnapshots.adjustedCloseFetchedAt,
      providerSymbol: assetPriceSnapshots.providerSymbol,
      providerExchange: assetPriceSnapshots.providerExchange,
      fetchedAt: assetPriceSnapshots.fetchedAt,
      source: assetPriceSnapshots.source,
    })
    .from(assetPriceSnapshots)
    .where(
      and(
        eq(assetPriceSnapshots.isSample, false),
        eq(
          sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
          ticker.toUpperCase(),
        ),
        eq(
          sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
          market.toLowerCase(),
        ),
        eq(
          sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
          currency.toUpperCase(),
        ),
      ),
    )
    .orderBy(asc(assetPriceSnapshots.priceDate));

  return rows;
}

async function loadPreferredScenarioCloseRows(input: {
  ticker: string;
  market: string;
  currency: string;
  tenantContext: TenantContext;
  activeOwnerUserIds: readonly string[];
}) {
  const rows = await loadScenarioCloseCandidates(
    input.ticker,
    input.market,
    input.currency,
  );
  const adjustedRows = admitAdjustedHistoricalPriceRows(rows).rows;
  const rawAdmission = admitPrivateSingleTenantRawHistoricalPriceRows({
    rows,
    requestedOwnerUserId: input.tenantContext.ownerUserId,
    activeOwnerUserIds: input.activeOwnerUserIds,
  });
  const preferred = selectPreferredPrivateHistoricalPriceRows({
    adjustedRows,
    privateRawRows: rawAdmission.rows,
  });

  return preferred.rows.map(({ row, priceBasis }) => ({
    priceDate: row.priceDate,
    closePrice: row.closePrice,
    adjustedClosePrice:
      priceBasis === "provider_adjusted_close"
        ? row.adjustedClosePrice
        : null,
    source:
      priceBasis === "provider_adjusted_close"
        ? row.adjustedCloseSource
        : row.source,
    priceBasis:
      priceBasis === "provider_adjusted_close"
        ? ("provider_adjusted_close" as const)
        : ("kis_raw_close" as const),
  }));
}

async function loadPrivateRawScenarioCloseRows(input: {
  ticker: string;
  market: string;
  currency: string;
  tenantContext: TenantContext;
  activeOwnerUserIds: readonly string[];
}) {
  const rows = await loadScenarioCloseCandidates(
    input.ticker,
    input.market,
    input.currency,
  );
  const admission = admitPrivateSingleTenantRawHistoricalPriceRows({
    rows,
    requestedOwnerUserId: input.tenantContext.ownerUserId,
    activeOwnerUserIds: input.activeOwnerUserIds,
  });

  return admission.rows.map((row) => ({
    priceDate: row.priceDate,
    closePrice: row.closePrice,
    adjustedClosePrice: row.adjustedClosePrice,
    source: row.source,
    priceBasis: "kis_raw_close" as const,
  }));
}

export async function getReadOnlyTenantInvestmentLabCounterfactual({
  account = "all",
  fixedMixSelection,
  request,
  requestedAnchorDate,
  tenantContext,
}: {
  account?: PortfolioAccountScope;
  fixedMixSelection?: InvestmentLabFixedMixSelection;
  request?: InvestmentLabPeriodRequest;
  requestedAnchorDate?: string | null;
  tenantContext: TenantContext;
}) {
  const activeOwnerUserIdsPromise = getActivePortfolioOwnerUserIds();
  return loadInvestmentLabCounterfactualReadModel(
    createTenantInvestmentLabRepository(
      tenantContext,
      account,
      activeOwnerUserIdsPromise,
    ),
    request,
    fixedMixSelection,
    requestedAnchorDate,
    account,
  );
}

export async function getReadOnlyTenantInvestmentLabCounterfactualForScope({
  evidencePromise,
  fixedMixSelection,
  request,
  requestedAnchorDate,
  scope,
  tenantContext,
}: {
  evidencePromise: Promise<InvestmentLabAnalysisScopeEvidence>;
  fixedMixSelection?: InvestmentLabFixedMixSelection;
  request?: InvestmentLabPeriodRequest;
  requestedAnchorDate?: string | null;
  scope: PortfolioAnalysisScope;
  tenantContext: TenantContext;
}) {
  const evidence = await evidencePromise;
  const activeOwnerUserIdsPromise = getActivePortfolioOwnerUserIds();
  const result = await loadInvestmentLabCounterfactualReadModel(
    createTenantInvestmentLabScopeRepository(
      tenantContext,
      evidence,
      activeOwnerUserIdsPromise,
    ),
    request,
    fixedMixSelection,
    requestedAnchorDate,
    evidence.engineAccount,
  );
  const fountScopeAdjustment =
    evidence.fountAdjustment.status === "applied"
      ? Object.freeze({
          status: "applied" as const,
          policy: INVESTMENT_LAB_FOUNT_RUNTIME_SCOPE_POLICY,
          adjustedDateCount: evidence.fountAdjustment.adjustedDateCount,
          excludedAccount: "irp" as const,
        })
      : result.fountScopeAdjustment;

  return Object.freeze({
    ...result,
    analysisScope: scope,
    fountScopeAdjustment,
  });
}

function activeOwnedAccountPredicates(tenantContext: TenantContext) {
  return [
    eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
    eq(accounts.isActive, true),
    inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
  ];
}

function shiftIsoDate(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeUpper(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
