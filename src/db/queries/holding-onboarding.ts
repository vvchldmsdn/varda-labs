import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, portfolioGroups } from "@/db/schema";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type HoldingOnboardingOptions = Readonly<{
  state: "ready";
  accounts: readonly Readonly<{
    id: string;
    code: string;
    name: string;
    accountType: string;
  }>[];
  portfolioGroups: readonly Readonly<{
    id: string;
    name: string;
  }>[];
}>;

export type HoldingOnboardingOptionsResult =
  | HoldingOnboardingOptions
  | Readonly<{ state: "unavailable" }>;

export async function getHoldingOnboardingOptions(
  tenantContext: TenantContext,
): Promise<HoldingOnboardingOptionsResult> {
  try {
    const [ownedAccounts, ownedGroups] = await Promise.all([
      db
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          accountType: accounts.accountType,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
            eq(accounts.isActive, true),
          ),
        )
        .orderBy(asc(accounts.sortOrder), asc(accounts.name), asc(accounts.code)),
      db
        .select({
          id: portfolioGroups.id,
          name: portfolioGroups.name,
        })
        .from(portfolioGroups)
        .where(
          and(
            eq(
              portfolioGroups.canonicalOwnerUserId,
              tenantContext.ownerUserId,
            ),
            isNull(portfolioGroups.archivedAt),
          ),
        )
        .orderBy(asc(portfolioGroups.sortOrder), asc(portfolioGroups.name)),
    ]);

    return Object.freeze({
      state: "ready",
      accounts: Object.freeze(ownedAccounts.map((row) => Object.freeze(row))),
      portfolioGroups: Object.freeze(
        ownedGroups.map((row) => Object.freeze(row)),
      ),
    });
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}
