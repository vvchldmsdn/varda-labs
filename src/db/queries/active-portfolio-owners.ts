import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, appUsers } from "@/db/schema";

export async function getActivePortfolioOwnerUserIds() {
  const rows = await db
    .selectDistinct({ ownerUserId: accounts.canonicalOwnerUserId })
    .from(accounts)
    .innerJoin(appUsers, eq(accounts.canonicalOwnerUserId, appUsers.id))
    .where(
      and(
        eq(accounts.isActive, true),
        eq(appUsers.status, "active"),
        inArray(appUsers.role, ["user", "admin"]),
        isNotNull(accounts.canonicalOwnerUserId),
      ),
    )
    .orderBy(asc(accounts.canonicalOwnerUserId));

  return Object.freeze(
    rows
      .map((row) => row.ownerUserId)
      .filter((value): value is string => value !== null),
  );
}
