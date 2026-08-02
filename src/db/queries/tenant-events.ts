import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, eventLedgerEntries } from "@/db/schema";
import { HISTORY_EVENT_QUERY_LIMIT } from "@/lib/history-event-timeline";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import {
  projectTenantEventLedgerRows,
  type TenantEventLedgerReadResult,
} from "@/lib/tenant-event-ledger-read-model";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantEventLedgerQueryResult =
  | TenantEventLedgerReadResult
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantEvents({
  tenantContext,
  scope,
}: {
  tenantContext: TenantContext;
  scope: PortfolioAccountScope;
}): Promise<TenantEventLedgerQueryResult> {
  try {
    const predicates = [
      eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
      eq(accounts.isActive, true),
      inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
      eq(eventLedgerEntries.account, accounts.code),
      eq(eventLedgerEntries.isSample, false),
    ];
    if (scope !== "all") predicates.push(eq(accounts.code, scope));

    const rows = await db
      .select({
        internalId: eventLedgerEntries.id,
        legacyBase44Id: eventLedgerEntries.legacyBase44Id,
        eventAccountId: eventLedgerEntries.accountId,
        ownedAccountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountSortOrder: accounts.sortOrder,
        isSample: eventLedgerEntries.isSample,
        eventDate: eventLedgerEntries.eventDate,
        eventType: eventLedgerEntries.eventType,
        source: eventLedgerEntries.source,
        recordedAt: eventLedgerEntries.recordedAt,
        ruleVersion: eventLedgerEntries.ruleVersion,
        account: eventLedgerEntries.account,
        assetId: eventLedgerEntries.assetId,
        legacyAssetId: eventLedgerEntries.legacyAssetId,
        ticker: eventLedgerEntries.ticker,
        assetName: eventLedgerEntries.assetName,
        groupName: eventLedgerEntries.groupName,
        correctsEventId: eventLedgerEntries.correctsEventId,
        legacyCorrectsEventId: eventLedgerEntries.legacyCorrectsEventId,
        amountKrw: eventLedgerEntries.amountKrw,
        quantityDelta: eventLedgerEntries.quantityDelta,
        price: eventLedgerEntries.price,
        fxRate: eventLedgerEntries.fxRate,
      })
      .from(eventLedgerEntries)
      .innerJoin(accounts, eq(eventLedgerEntries.accountId, accounts.id))
      .where(and(...predicates))
      .orderBy(
        desc(eventLedgerEntries.eventDate),
        sql`${eventLedgerEntries.recordedAt} desc nulls last`,
        asc(accounts.sortOrder),
        asc(accounts.code),
        desc(eventLedgerEntries.createdAt),
        asc(eventLedgerEntries.id),
      )
      .limit(HISTORY_EVENT_QUERY_LIMIT);

    return projectTenantEventLedgerRows(rows, scope);
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}
