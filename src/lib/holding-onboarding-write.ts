import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { runPortfolioMutation } from "@/lib/portfolio-mutation-transaction";
import {
  accounts,
  assetPriceSnapshots,
  etfMasters,
  livePriceQuotes,
} from "@/db/schema";
import { resolveOnboardingInstrumentById } from "@/db/queries/onboarding-instrument-search";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  HOLDING_ONBOARDING_POLICY,
  DEFAULT_HOLDING_PORTFOLIO_GROUP_NAME,
  parseHoldingOnboardingInput,
  type HoldingOnboardingActionState,
  type HoldingOnboardingInput,
} from "@/lib/holding-onboarding";
import {
  assertActiveTenantWriteAllowed,
  prepareTenantWriteContext,
} from "@/lib/tenant-write-context";
import { closeCalendarReferenceDateForAsset, resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { TENANT_LIVE_PRICE_SYNC_POLICY } from "@/lib/market-data/tenant-live-price-sync-policy";
import { runMarketPriceSync } from "@/lib/market-data/price-sync";
import { createKisMarketDataProvider, getKisProviderPolicy } from "@/lib/market-data/providers/kis";

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
    // Verify the destination before spending a shared provider request. The
    // transaction checks it again after market I/O to protect lifecycle races.
    const ownedAccounts = await db.select({ id: accounts.id }).from(accounts).where(
      and(eq(accounts.id, parsed.input.accountId), eq(accounts.canonicalOwnerUserId, ownerUserId), eq(accounts.isActive, true)),
    ).limit(1);
    if (ownedAccounts.length !== 1) return state("conflict", "보유 계좌를 다시 확인해 주세요.");

    let input = parsed.input;
    if (input.instrumentId) {
      const selected = await resolveOnboardingInstrumentById(input.instrumentId);
      if (!selected || selected.ticker !== input.ticker || selected.market !== input.market ||
          selected.currency !== input.currency || selected.assetType !== input.assetType) {
        return state("invalid", "검색 결과에서 종목을 다시 선택해 주세요.");
      }
      input = Object.freeze({ ...input, name: selected.name });
    }
    const [price, resolvedName] = await Promise.all([
      resolvePriceEvidence(input),
      resolveAssetName(input),
    ]);
    if (price === null) {
      return state(
        "price_unavailable",
        "종목 가격을 확인하지 못했습니다. 잠시 후 다시 저장하거나 현재 1좌 가격을 입력해 주세요.",
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
      referencedOwnerUserIds: [ownerUserId],
    });

    const recordedAt = new Date();
    const assetId = randomUUID();
    // The owner lock is acquired before the transaction rechecks account/group
    // ownership and lifecycle. Price preparation above touches only shared market
    // evidence; it never mutates another user's holdings.
    const rows = await runPortfolioMutation(ownerUserId, ATOMIC_ONBOARDING_QUERY, [
      ownerUserId, assetId, input.accountId, input.portfolioGroupId,
      randomUUID(), input.newPortfolioGroupName, recordedAt.toISOString(),
      resolveSnapshotCycle(recordedAt).snapshotDate, resolvedName, input.ticker,
      input.assetType, input.market, input.currency, input.quantity,
      input.averageCost, price.currentPrice, price.priceSource,
      price.priceFetchedAt.toISOString(), price.priceAsOf?.toISOString() ?? null,
      price.priceQuoteType, input.reportedReturnPct, HOLDING_ONBOARDING_POLICY.version,
    ]);
    if (Number(rows[0]?.saved_count ?? 0) !== 1) {
      return state("conflict", "계좌 또는 분석 범위가 변경되었거나 보관되었습니다. 화면을 새로고침해 주세요.");
    }
    return state("success", "보유종목을 분석 범위에 추가했습니다.", assetId);
  } catch (error) {
    if (error instanceof OnboardingPriceUnavailableError) {
      return Object.freeze({
        status: "price_unavailable",
        message: error.message,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      });
    }
    if (isUniqueViolation(error)) {
      return state(
        "conflict",
        "같은 종목이나 분석 범위가 먼저 등록되었습니다. 화면을 새로고침해 주세요.",
      );
    }
    const code = typeof error === "object" && error !== null && "code" in error
      ? String(error.code) : null;
    if (["23503", "55P03", "57014"].includes(code ?? "")) {
      return state("conflict", "다른 변경이 먼저 반영되었습니다. 화면을 새로고침해 주세요.");
    }
    return state(
      "error",
      "보유종목을 저장하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
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

  const cached = await readCurrentPriceEvidence(input, now);
  if (cached) return cached;
  if (!getKisProviderPolicy().configured) {
    throw new OnboardingPriceUnavailableError("자동 가격 조회가 준비되지 않았습니다. 현재 1좌 가격을 입력하거나 잠시 후 다시 저장해 주세요.");
  }

  // One explicit instrument, with the existing shared KIS lease and cooldown.
  // Never retry here, fetch the portfolio universe, or write a user's other assets.
  try {
    await runMarketPriceSync({
      mode: "live", dryRun: false, targetLimit: 1,
      explicitTargets: [{ ticker: input.ticker, market: input.market, currency: input.currency }],
      provider: createKisMarketDataProvider(),
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "provider_cooldown") {
      const details = "details" in error ? error.details : null;
      const wait = typeof details === "object" && details !== null && "retryAfterSeconds" in details
        ? Number(details.retryAfterSeconds) : 90;
      const retryAfterSeconds = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : 90;
      throw new OnboardingPriceUnavailableError(`가격 조회가 진행 중입니다. ${retryAfterSeconds}초 후 다시 저장하거나 현재 1좌 가격을 입력해 주세요.`, retryAfterSeconds);
    }
    throw new OnboardingPriceUnavailableError("종목 가격을 확인하지 못했습니다. 잠시 후 다시 저장하거나 현재 1좌 가격을 입력해 주세요.");
  }
  return readCurrentPriceEvidence(input, new Date());
}

async function readCurrentPriceEvidence(input: HoldingOnboardingInput, now: Date): Promise<PriceEvidence | null> {

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
        gte(livePriceQuotes.fetchedAt, new Date(now.getTime() - TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds)),
        lte(livePriceQuotes.fetchedAt, new Date(now.getTime() + 60_000)),
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
        gte(assetPriceSnapshots.priceDate, closeCalendarReferenceDateForAsset(input, resolveSnapshotCycle(now).snapshotDate)),
        lte(assetPriceSnapshots.priceDate, new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)),
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

class OnboardingPriceUnavailableError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "OnboardingPriceUnavailableError";
  }
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

const ATOMIC_ONBOARDING_QUERY = `
with owned_account as materialized (
  select id, code from accounts
  where id = $3::uuid and canonical_owner_user_id = $1::uuid and is_active = true
  for update
), existing_group as materialized (
  select id from portfolio_groups
  where canonical_owner_user_id = $1::uuid and archived_at is null
    and (id = $4::uuid or ($4::uuid is null and lower(name) = lower(coalesce($6::varchar, '${DEFAULT_HOLDING_PORTFOLIO_GROUP_NAME}'))))
  for update
), created_group as (
  insert into portfolio_groups (id, canonical_owner_user_id, name, sort_order, created_at, updated_at)
  select $5::uuid, $1::uuid, coalesce($6::varchar, '${DEFAULT_HOLDING_PORTFOLIO_GROUP_NAME}'),
    coalesce((select max(sort_order) from portfolio_groups where canonical_owner_user_id = $1::uuid), -1) + 1,
    $7::timestamptz, $7::timestamptz
  where $4::uuid is null
    and exists (select 1 from owned_account)
    and not exists (select 1 from portfolio_groups
      where canonical_owner_user_id = $1::uuid and archived_at is null and lower(name) = lower(coalesce($6::varchar, '${DEFAULT_HOLDING_PORTFOLIO_GROUP_NAME}')))
  returning id
), selected_group as materialized (
  select id from existing_group union all select id from created_group
), inserted_asset as (
  insert into assets (
    id, canonical_owner_user_id, account_id, account, name, ticker, asset_type,
    market, currency, quantity, average_cost, current_price, price_source,
    price_fetched_at, price_as_of, price_quote_type, price_status, created_at, updated_at
  )
  select $2::uuid, $1::uuid, account.id, account.code, $9::varchar, $10::varchar,
    $11::varchar, $12::varchar, $13::varchar, $14::numeric, $15::numeric, $16::numeric,
    $17::varchar, $18::timestamptz, $19::timestamptz, $20::varchar, 'ok', $7::timestamptz, $7::timestamptz
  from owned_account account cross join selected_group
  returning id
), inserted_evidence as (
  insert into holding_onboarding_evidence (
    id, canonical_owner_user_id, asset_id, account_id, quantity, average_cost,
    current_price, reported_return_pct, currency, price_source, price_as_of,
    policy_version, recorded_at, created_at
  )
  select gen_random_uuid(), $1::uuid, asset.id, $3::uuid, $14::numeric, $15::numeric,
    $16::numeric, $21::numeric, $13::varchar, $17::varchar, $19::timestamptz,
    $22::varchar, $7::timestamptz, $7::timestamptz from inserted_asset asset
  returning asset_id
), inserted_membership as (
  insert into portfolio_group_asset_memberships (
    id, canonical_owner_user_id, portfolio_group_id, asset_id, valid_from, created_at
  )
  select gen_random_uuid(), $1::uuid, group_row.id, evidence.asset_id, $8::date, $7::timestamptz
  from inserted_evidence evidence cross join selected_group group_row
  returning asset_id
)
select count(*) as saved_count from inserted_membership
`;
