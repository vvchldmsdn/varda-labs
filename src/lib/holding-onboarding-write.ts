import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  assetPriceSnapshots,
  assets,
  etfMasters,
  holdingOnboardingEvidence,
  livePriceQuotes,
  portfolioGroupAssetMemberships,
  portfolioGroups,
} from "@/db/schema";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  HOLDING_ONBOARDING_POLICY,
  parseHoldingOnboardingInput,
  type HoldingOnboardingActionState,
  type HoldingOnboardingInput,
} from "@/lib/holding-onboarding";
import {
  assertActiveTenantWriteAllowed,
  canonicalOwnerAssignment,
  prepareTenantWriteContext,
} from "@/lib/tenant-write-context";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

type PriceEvidence = Readonly<{
  currentPrice: string;
  priceSource: string;
  priceFetchedAt: Date;
  priceAsOf: Date | null;
  priceQuoteType: string;
}>;

export async function writeSessionHoldingOnboarding(
  formData: FormData,
): Promise<HoldingOnboardingActionState> {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return state("unauthorized", "로그인과 사용자 연결을 확인해 주세요.");
  }

  const parsed = parseHoldingOnboardingInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

  const ownerUserId = resolution.tenantContext.ownerUserId;

  try {
    const accountRows = await db
      .select({
        id: accounts.id,
        code: accounts.code,
        ownerUserId: accounts.canonicalOwnerUserId,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, parsed.input.accountId),
          eq(accounts.canonicalOwnerUserId, ownerUserId),
          eq(accounts.isActive, true),
        ),
      )
      .limit(2);
    if (accountRows.length !== 1) {
      return state("conflict", "선택한 계좌를 사용할 수 없습니다.");
    }
    const [account] = accountRows;

    const group = await resolvePortfolioGroup(parsed.input, ownerUserId);
    if (!group.ok) return state("conflict", group.message);

    const duplicate = await db
      .select({ id: assets.id, archivedAt: assets.archivedAt })
      .from(assets)
      .where(
        and(
          eq(assets.canonicalOwnerUserId, ownerUserId),
          eq(assets.accountId, account.id),
          sql`lower(btrim(${assets.market})) = ${parsed.input.market}`,
          sql`upper(btrim(${assets.currency})) = ${parsed.input.currency}`,
          sql`upper(btrim(${assets.ticker})) = ${parsed.input.ticker}`,
        ),
      )
      .limit(1);
    if (duplicate.length > 0) {
      return state(
        "conflict",
        duplicate[0]?.archivedAt === null
          ? "같은 계좌에 이미 등록된 종목입니다. 기존 보유종목을 수정해 주세요."
          : "같은 계좌에 종료된 보유종목이 있습니다. 보유종목 화면에서 복원해 주세요.",
      );
    }

    const [price, resolvedName] = await Promise.all([
      resolvePriceEvidence(parsed.input),
      resolveAssetName(parsed.input),
    ]);
    if (price === null) {
      return state(
        "invalid",
        "저장된 최신 가격이 없습니다. 현재 1좌 가격을 입력해 주세요.",
      );
    }

    const writeContext = prepareTenantWriteContext({
      mode: "active",
      source: "session",
      targetClassification: "user_owned",
      canonicalOwnerUserId: ownerUserId,
      canonicalOwnerStatus: "active",
      canonicalOwnerVerified: true,
    });
    assertActiveTenantWriteAllowed({
      context: writeContext,
      operation: "insert",
      referencedOwnerUserIds: [account.ownerUserId, group.ownerUserId],
    });

    const recordedAt = new Date();
    const assetId = randomUUID();
    const canonicalOwner = canonicalOwnerAssignment(writeContext);
    const canonicalOwnerUserId = canonicalOwner.canonicalOwnerUserId;
    if (!canonicalOwnerUserId) {
      return state("error", "사용자 소유권을 확인하지 못했습니다.");
    }
    const assetInsert = db.insert(assets).values({
      id: assetId,
      canonicalOwnerUserId,
      name: resolvedName,
      ticker: parsed.input.ticker,
      assetType: parsed.input.assetType,
      market: parsed.input.market,
      currency: parsed.input.currency,
      account: account.code,
      accountId: account.id,
      quantity: parsed.input.quantity,
      averageCost: parsed.input.averageCost,
      currentPrice: price.currentPrice,
      priceSource: price.priceSource,
      priceFetchedAt: price.priceFetchedAt,
      priceAsOf: price.priceAsOf,
      priceQuoteType: price.priceQuoteType,
      priceStatus: "ok",
      createdAt: recordedAt,
      updatedAt: recordedAt,
    });
    const evidenceInsert = db.insert(holdingOnboardingEvidence).values({
      id: randomUUID(),
      canonicalOwnerUserId,
      assetId,
      accountId: account.id,
      quantity: parsed.input.quantity,
      averageCost: parsed.input.averageCost,
      currentPrice: price.currentPrice,
      reportedReturnPct: parsed.input.reportedReturnPct,
      currency: parsed.input.currency,
      priceSource: price.priceSource,
      priceAsOf: price.priceAsOf,
      policyVersion: HOLDING_ONBOARDING_POLICY.version,
      recordedAt,
      createdAt: recordedAt,
    });
    const membershipInsert = db
      .insert(portfolioGroupAssetMemberships)
      .values({
        id: randomUUID(),
        canonicalOwnerUserId,
        portfolioGroupId: group.id,
        assetId,
        validFrom: resolveSnapshotCycle(recordedAt).snapshotDate,
        createdAt: recordedAt,
      });

    if (group.create) {
      const groupInsert = db.insert(portfolioGroups).values({
        id: group.id,
        canonicalOwnerUserId,
        name: group.name,
        sortOrder: group.sortOrder,
        createdAt: recordedAt,
        updatedAt: recordedAt,
      });
      await db.batch([
        groupInsert,
        assetInsert,
        evidenceInsert,
        membershipInsert,
      ]);
    } else {
      await db.batch([assetInsert, evidenceInsert, membershipInsert]);
    }
    return state("success", "보유종목을 자산 그룹에 추가했습니다.", assetId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return state(
        "conflict",
        "같은 종목이나 자산 그룹이 먼저 등록되었습니다. 화면을 새로고침해 주세요.",
      );
    }
    return state(
      "error",
      "보유종목을 저장하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
}

async function resolvePortfolioGroup(
  input: HoldingOnboardingInput,
  ownerUserId: string,
): Promise<
  | Readonly<{
      ok: true;
      id: string;
      name: string;
      ownerUserId: string;
      create: boolean;
      sortOrder: number;
    }>
  | Readonly<{ ok: false; message: string }>
> {
  if (input.portfolioGroupId) {
    const rows = await db
      .select({
        id: portfolioGroups.id,
        name: portfolioGroups.name,
        ownerUserId: portfolioGroups.canonicalOwnerUserId,
        sortOrder: portfolioGroups.sortOrder,
      })
      .from(portfolioGroups)
      .where(
        and(
          eq(portfolioGroups.id, input.portfolioGroupId),
          eq(portfolioGroups.canonicalOwnerUserId, ownerUserId),
          isNull(portfolioGroups.archivedAt),
        ),
      )
      .limit(2);
    return rows.length === 1
      ? Object.freeze({ ok: true, ...rows[0], create: false })
      : Object.freeze({
          ok: false,
          message: "선택한 자산 그룹을 사용할 수 없습니다.",
        });
  }

  const name = input.newPortfolioGroupName!;
  const [duplicate, latest] = await Promise.all([
    db
      .select({ id: portfolioGroups.id })
      .from(portfolioGroups)
      .where(
        and(
          eq(portfolioGroups.canonicalOwnerUserId, ownerUserId),
          isNull(portfolioGroups.archivedAt),
          sql`lower(btrim(${portfolioGroups.name})) = ${name.toLowerCase()}`,
        ),
      )
      .limit(1),
    db
      .select({ sortOrder: portfolioGroups.sortOrder })
      .from(portfolioGroups)
      .where(
        and(
          eq(portfolioGroups.canonicalOwnerUserId, ownerUserId),
          isNull(portfolioGroups.archivedAt),
        ),
      )
      .orderBy(desc(portfolioGroups.sortOrder))
      .limit(1),
  ]);
  if (duplicate.length > 0) {
    return Object.freeze({
      ok: false,
      message: "같은 이름의 자산 그룹이 이미 있습니다.",
    });
  }

  return Object.freeze({
    ok: true,
    id: randomUUID(),
    name,
    ownerUserId,
    create: true,
    sortOrder: (latest[0]?.sortOrder ?? -1) + 1,
  });
}

async function resolveAssetName(input: HoldingOnboardingInput) {
  if (input.name) return input.name;
  if (input.assetType !== "etf") return input.ticker;

  const rows = await db
    .select({ name: etfMasters.name })
    .from(etfMasters)
    .where(
      and(
        eq(etfMasters.ticker, input.ticker),
        eq(etfMasters.market, input.market),
        eq(etfMasters.isActive, true),
        eq(etfMasters.isSample, false),
      ),
    )
    .limit(1);
  return rows[0]?.name.trim() || input.ticker;
}

async function resolvePriceEvidence(
  input: HoldingOnboardingInput,
): Promise<PriceEvidence | null> {
  const now = new Date();
  if (input.currentPrice) {
    return Object.freeze({
      currentPrice: input.currentPrice,
      priceSource: "user_entered_onboarding",
      priceFetchedAt: now,
      priceAsOf: now,
      priceQuoteType: "manual",
    });
  }

  const liveRows = await db
    .select({
      price: livePriceQuotes.price,
      source: livePriceQuotes.source,
      quoteType: livePriceQuotes.quoteType,
      priceAsOf: livePriceQuotes.priceAsOf,
      fetchedAt: livePriceQuotes.fetchedAt,
    })
    .from(livePriceQuotes)
    .where(
      and(
        eq(livePriceQuotes.market, input.market),
        eq(livePriceQuotes.currency, input.currency),
        eq(livePriceQuotes.ticker, input.ticker),
        eq(livePriceQuotes.status, "ok"),
        sql`${livePriceQuotes.price} > 0`,
      ),
    )
    .orderBy(desc(livePriceQuotes.fetchedAt))
    .limit(1);
  if (liveRows[0]) {
    return Object.freeze({
      currentPrice: liveRows[0].price,
      priceSource: liveRows[0].source,
      priceFetchedAt: liveRows[0].fetchedAt,
      priceAsOf: liveRows[0].priceAsOf,
      priceQuoteType: liveRows[0].quoteType,
    });
  }

  const closeRows = await db
    .select({
      price: assetPriceSnapshots.closePrice,
      priceDate: assetPriceSnapshots.priceDate,
      source: assetPriceSnapshots.source,
      fetchedAt: assetPriceSnapshots.fetchedAt,
    })
    .from(assetPriceSnapshots)
    .where(
      and(
        eq(assetPriceSnapshots.market, input.market),
        eq(assetPriceSnapshots.currency, input.currency),
        eq(assetPriceSnapshots.ticker, input.ticker),
        eq(assetPriceSnapshots.isSample, false),
        sql`${assetPriceSnapshots.closePrice} > 0`,
      ),
    )
    .orderBy(
      desc(assetPriceSnapshots.priceDate),
      desc(assetPriceSnapshots.fetchedAt),
    )
    .limit(1);
  if (!closeRows[0]) return null;

  return Object.freeze({
    currentPrice: closeRows[0].price,
    priceSource: closeRows[0].source ?? "asset_price_snapshot",
    priceFetchedAt: closeRows[0].fetchedAt ?? now,
    priceAsOf: new Date(`${closeRows[0].priceDate}T00:00:00.000Z`),
    priceQuoteType: "close",
  });
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function state(
  status: HoldingOnboardingActionState["status"],
  message: string,
  assetId?: string,
): HoldingOnboardingActionState {
  return Object.freeze({ status, message, ...(assetId ? { assetId } : {}) });
}
