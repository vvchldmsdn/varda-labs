import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, assets } from "@/db/schema";
import {
  buildTargetPolicyHoldingUniverse,
  normalizeTargetPolicyUniverseAccount,
} from "@/lib/target-policy-holding-universe";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getReadOnlyTenantTargetPolicyHoldingUniverse({
  account: accountInput,
  tenantContext,
}: {
  account: string;
  tenantContext: TenantContext;
}) {
  const account = normalizeTargetPolicyUniverseAccount(accountInput);
  if (!account) {
    return buildTargetPolicyHoldingUniverse({
      account: accountInput,
      holdings: [],
    });
  }

  const holdings = await db
    .select({
      name: assets.name,
      market: assets.market,
      currency: assets.currency,
      ticker: assets.ticker,
    })
    .from(assets)
    .innerJoin(accounts, eq(assets.accountId, accounts.id))
    .where(
      and(
        eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
        eq(accounts.isActive, true),
        eq(accounts.code, account),
        eq(assets.account, accounts.code),
        sql<boolean>`(${assets.quantity} > 0 or coalesce(${assets.fractionalKrwValue}, 0) > 0)`,
      ),
    )
    .orderBy(
      asc(assets.market),
      asc(assets.currency),
      asc(assets.ticker),
      asc(assets.name),
    );

  return buildTargetPolicyHoldingUniverse({ account, holdings });
}
