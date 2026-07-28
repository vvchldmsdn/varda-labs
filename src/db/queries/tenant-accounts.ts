import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import {
  projectTenantAccountRows,
  type TenantAccountReadResult,
} from "@/lib/tenant-account-read-model";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantAccountQueryResult =
  | TenantAccountReadResult
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantAccounts({
  tenantContext,
  scope,
}: {
  tenantContext: TenantContext;
  scope: PortfolioAccountScope;
}): Promise<TenantAccountQueryResult> {
  try {
    const predicates = [
      eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
      eq(accounts.isActive, true),
      inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
    ];
    if (scope !== "all") predicates.push(eq(accounts.code, scope));

    const rows = await db
      .select({
        code: accounts.code,
        name: accounts.name,
        accountType: accounts.accountType,
        currency: accounts.currency,
        sortOrder: accounts.sortOrder,
      })
      .from(accounts)
      .where(and(...predicates))
      .orderBy(asc(accounts.sortOrder), asc(accounts.code));

    return projectTenantAccountRows(rows, scope);
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}
