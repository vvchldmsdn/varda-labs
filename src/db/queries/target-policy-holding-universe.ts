import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assets } from "@/db/schema";
import {
  buildTargetPolicyHoldingUniverse,
  normalizeTargetPolicyUniverseAccount,
} from "@/lib/target-policy-holding-universe";

export async function getTargetPolicyHoldingUniverse(accountInput: string) {
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
    .where(
      and(
        eq(assets.account, account),
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
