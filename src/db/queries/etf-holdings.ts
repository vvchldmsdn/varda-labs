import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

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
    .select()
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
