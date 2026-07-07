import "server-only";

import { and, asc, desc, eq, ilike, or } from "drizzle-orm";

import { db } from "@/db/client";
import { etfHoldings, etfMasters, type EtfMaster } from "@/db/schema";
import {
  groupEtfHoldingRows,
  type EtfHoldingRawRow,
  type GroupedEtfHoldingsResult,
} from "@/lib/etf-holdings";

export type ReadOnlyEtfHoldingsSelection = {
  etfMasterId?: string;
  etfTicker?: string;
  asOfDate?: string;
};

export type ReadOnlyEtfHoldingsResult = {
  requested: ReadOnlyEtfHoldingsSelection;
  etfMaster: Pick<
    EtfMaster,
    "id" | "legacyBase44Id" | "ticker" | "name" | "market" | "currency"
  > | null;
  etfTicker: string;
  asOfDate: string;
  rawRowCount: number;
  groupedRowCount: number;
  duplicateGroupCount: number;
  groupedHoldings: GroupedEtfHoldingsResult["groups"];
};

export type ReadOnlyEtfMasterSearchResult = Pick<
  EtfMaster,
  | "id"
  | "legacyBase44Id"
  | "ticker"
  | "name"
  | "market"
  | "currency"
  | "issuer"
  | "assetClass"
  | "categoryLabel"
  | "isActive"
  | "isUniversePick"
>;

export async function searchReadOnlyEtfMasters({
  query,
  limit = 24,
}: {
  query?: string | null;
  limit?: number;
} = {}): Promise<ReadOnlyEtfMasterSearchResult[]> {
  const searchQuery = normalizeSearchInput(query);
  const rowLimit = Math.min(Math.max(limit, 1), 50);
  const selectedColumns = {
    id: etfMasters.id,
    legacyBase44Id: etfMasters.legacyBase44Id,
    ticker: etfMasters.ticker,
    name: etfMasters.name,
    market: etfMasters.market,
    currency: etfMasters.currency,
    issuer: etfMasters.issuer,
    assetClass: etfMasters.assetClass,
    categoryLabel: etfMasters.categoryLabel,
    isActive: etfMasters.isActive,
    isUniversePick: etfMasters.isUniversePick,
  };

  if (searchQuery) {
    const pattern = containsPattern(searchQuery);
    return db
      .select(selectedColumns)
      .from(etfMasters)
      .where(
        or(
          ilike(etfMasters.ticker, pattern),
          ilike(etfMasters.name, pattern),
          ilike(etfMasters.issuer, pattern),
          ilike(etfMasters.categoryLabel, pattern),
        ),
      )
      .orderBy(
        desc(etfMasters.isUniversePick),
        desc(etfMasters.isActive),
        asc(etfMasters.ticker),
        asc(etfMasters.market),
      )
      .limit(rowLimit);
  }

  return db
    .select(selectedColumns)
    .from(etfMasters)
    .orderBy(
      desc(etfMasters.isUniversePick),
      desc(etfMasters.isActive),
      asc(etfMasters.ticker),
      asc(etfMasters.market),
    )
    .limit(rowLimit);
}

export async function getReadOnlyEtfHoldings(
  selection: ReadOnlyEtfHoldingsSelection,
): Promise<ReadOnlyEtfHoldingsResult | null> {
  const etfMaster = await findEtfMaster(selection);
  const etfTicker = normalizeTickerInput(selection.etfTicker ?? etfMaster?.ticker);

  if (!selection.etfMasterId && !etfTicker) {
    throw new Error("Either etfMasterId or etfTicker is required");
  }

  const latestAsOfDate =
    selection.asOfDate ??
    (await findLatestHoldingDate({
      etfMasterId: selection.etfMasterId ?? etfMaster?.id ?? null,
      etfTicker,
    }));

  if (!latestAsOfDate) return null;

  const rows = await loadHoldingRows({
    etfMasterId: selection.etfMasterId ?? etfMaster?.id ?? null,
    etfTicker,
    asOfDate: latestAsOfDate,
  });
  const grouped = groupEtfHoldingRows(rows);

  return {
    requested: selection,
    etfMaster: etfMaster
      ? {
          id: etfMaster.id,
          legacyBase44Id: etfMaster.legacyBase44Id,
          ticker: etfMaster.ticker,
          name: etfMaster.name,
          market: etfMaster.market,
          currency: etfMaster.currency,
        }
      : null,
    etfTicker: etfTicker ?? rows[0]?.etfTicker ?? "",
    asOfDate: latestAsOfDate,
    rawRowCount: grouped.rawRowCount,
    groupedRowCount: grouped.groupedRowCount,
    duplicateGroupCount: grouped.duplicateGroupCount,
    groupedHoldings: grouped.groups,
  };
}

async function findEtfMaster(selection: ReadOnlyEtfHoldingsSelection) {
  if (selection.etfMasterId) {
    const rows = await db
      .select()
      .from(etfMasters)
      .where(eq(etfMasters.id, selection.etfMasterId))
      .limit(1);
    return rows[0] ?? null;
  }

  const etfTicker = normalizeTickerInput(selection.etfTicker);
  if (!etfTicker) return null;

  const rows = await db
    .select()
    .from(etfMasters)
    .where(eq(etfMasters.ticker, etfTicker))
    .orderBy(desc(etfMasters.isActive), asc(etfMasters.market))
    .limit(1);
  return rows[0] ?? null;
}

async function findLatestHoldingDate({
  etfMasterId,
  etfTicker,
}: {
  etfMasterId: string | null;
  etfTicker: string | null;
}) {
  const where = etfHoldingSelector({ etfMasterId, etfTicker });
  const rows = await db
    .select({ asOfDate: etfHoldings.asOfDate })
    .from(etfHoldings)
    .where(where)
    .orderBy(desc(etfHoldings.asOfDate))
    .limit(1);

  return rows[0]?.asOfDate ?? null;
}

async function loadHoldingRows({
  etfMasterId,
  etfTicker,
  asOfDate,
}: {
  etfMasterId: string | null;
  etfTicker: string | null;
  asOfDate: string;
}): Promise<EtfHoldingRawRow[]> {
  return db
    .select({
      id: etfHoldings.id,
      legacyBase44Id: etfHoldings.legacyBase44Id,
      etfMasterId: etfHoldings.etfMasterId,
      legacyEtfId: etfHoldings.legacyEtfId,
      etfTicker: etfHoldings.etfTicker,
      etfName: etfHoldings.etfName,
      asOfDate: etfHoldings.asOfDate,
      holdingSymbol: etfHoldings.holdingSymbol,
      holdingName: etfHoldings.holdingName,
      holdingMarket: etfHoldings.holdingMarket,
      holdingCountry: etfHoldings.holdingCountry,
      currency: etfHoldings.currency,
      sector: etfHoldings.sector,
      industry: etfHoldings.industry,
      securityType: etfHoldings.securityType,
      source: etfHoldings.source,
      rank: etfHoldings.rank,
      weightPct: etfHoldings.weightPct,
      shares: etfHoldings.shares,
      marketValue: etfHoldings.marketValue,
    })
    .from(etfHoldings)
    .where(
      and(
        etfHoldingSelector({ etfMasterId, etfTicker }),
        eq(etfHoldings.asOfDate, asOfDate),
      ),
    )
    .orderBy(asc(etfHoldings.rank), asc(etfHoldings.holdingName));
}

function etfHoldingSelector({
  etfMasterId,
  etfTicker,
}: {
  etfMasterId: string | null;
  etfTicker: string | null;
}) {
  if (etfMasterId) return eq(etfHoldings.etfMasterId, etfMasterId);
  if (etfTicker) return eq(etfHoldings.etfTicker, etfTicker);
  throw new Error("Either etfMasterId or etfTicker is required");
}

function normalizeTickerInput(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function normalizeSearchInput(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function containsPattern(value: string) {
  const escaped = value.replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
}
