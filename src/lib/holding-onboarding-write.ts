import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { runPortfolioMutation } from "@/lib/portfolio-mutation-transaction";
import { isNativeLedgerGuardError, NATIVE_LEDGER_REQUIRED_MESSAGE } from "@/lib/native-ledger-compatibility";
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
import { enqueueMarketCollection } from "@/lib/market-data/collection-queue";
import { scheduleMarketCollection } from "@/lib/market-data/collection-worker";
import { getKisProviderPolicy } from "@/lib/market-data/providers/kis";

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
  const operationId = formData.get("operationId");
  if (operationId !== null && (typeof operationId !== "string" || !operationId.trim() || operationId.length > 60)) {
    return state("invalid", "저장할 목록을 다시 확인해 주세요.");
  }
  // A retry keeps its identity even after a lost response or page reload. The
  // owner namespace prevents one user's request from claiming another's row.
  const operationHash = operationId === null ? null : createHash("sha256").update(`${ownerUserId}:holding-onboarding:${operationId}`).digest("hex");
  const assetId = operationHash ? `${operationHash.slice(0,8)}-${operationHash.slice(8,12)}-4${operationHash.slice(13,16)}-a${operationHash.slice(17,20)}-${operationHash.slice(20,32)}` : randomUUID();

  try {
    // Verify the destination before spending a shared provider request. The
    // transaction checks it again after market I/O to protect lifecycle races.
    const ownedAccounts = await db.select({ id: accounts.id, nativeState: accounts.nativeState }).from(accounts).where(
      and(eq(accounts.id, parsed.input.accountId), eq(accounts.canonicalOwnerUserId, ownerUserId), eq(accounts.isActive, true)),
    ).limit(1);
    if (ownedAccounts.length !== 1) return state("conflict", "보유 계좌를 다시 확인해 주세요.");
    if (ownedAccounts[0].nativeState != null) return state("conflict", NATIVE_LEDGER_REQUIRED_MESSAGE);
    if (operationId !== null) {
      const replay = await readOnboardingReplay(ownerUserId, assetId, parsed.input);
      if (replay) return replay;
    }

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
    if (Number(rows[0]?.native_account_count ?? 0) > 0) return state("conflict", NATIVE_LEDGER_REQUIRED_MESSAGE);
    if (Number(rows[0]?.saved_count ?? 0) !== 1) {
      return state("conflict", "계좌 또는 분석 범위가 변경되었거나 보관되었습니다. 화면을 새로고침해 주세요.");
    }
    return { ...state("success", "보유종목을 분석 범위에 추가했습니다.", assetId), ...(rows[0]?.first_holding_created === true ? { firstHoldingCreated: true as const } : {}) };
  } catch (error) {
    if (isNativeLedgerGuardError(error)) return state("conflict", NATIVE_LEDGER_REQUIRED_MESSAGE);
    if (error instanceof OnboardingPriceUnavailableError) {
      return Object.freeze({
        status: "price_unavailable",
        message: error.message,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      });
    }
    if (isUniqueViolation(error)) {
      if (operationId !== null) {
        const replay = await readOnboardingReplay(ownerUserId, assetId, parsed.input).catch(() => null);
        if (replay) return replay;
      }
      const existing = await runPortfolioMutation(ownerUserId, `
        select id, archived_at is not null as archived from assets
        where canonical_owner_user_id=$1::uuid and account_id=$2::uuid
          and lower(btrim(market))=$3::varchar and upper(btrim(currency))=$4::varchar and upper(btrim(ticker))=$5::varchar
        limit 1
      `, [ownerUserId, parsed.input.accountId, parsed.input.market, parsed.input.currency, parsed.input.ticker]).catch(() => []);
      if (existing.length) return {
        status: "conflict", conflictReason: existing[0].archived === true ? "archived_holding" : "existing_holding",
        message: existing[0].archived === true
          ? "이 계좌에 종료된 보유 기록이 있어요. 보유 관리에서 기존 기록을 확인하고 복원해 주세요."
          : "이 계좌에 이미 등록된 종목이에요. 보유 관리에서 수량을 확인해 주세요. 새로 매수했다면 거래 기록에 남겨 주세요.",
      };
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

async function readOnboardingReplay(owner: string, assetId: string, input: HoldingOnboardingInput): Promise<HoldingOnboardingActionState | null> {
  const rows = await runPortfolioMutation(owner, `
    select exists (
      select 1 from holding_onboarding_evidence e
      join portfolio_group_asset_memberships m on m.asset_id=e.asset_id and m.canonical_owner_user_id=e.canonical_owner_user_id
      join portfolio_groups g on g.id=m.portfolio_group_id and g.canonical_owner_user_id=e.canonical_owner_user_id
      where e.asset_id=a.id and e.canonical_owner_user_id=$1::uuid
        and e.account_id=$3::uuid and e.quantity=$7::numeric
        and e.average_cost is not distinct from $8::numeric
        and e.reported_return_pct is not distinct from $9::numeric
        and ($10::numeric is null or (e.current_price=$10::numeric and e.price_source='user_entered_onboarding'))
        and (g.id=$11::uuid or ($11::uuid is null and lower(g.name)=lower(coalesce($12::varchar, '${DEFAULT_HOLDING_PORTFOLIO_GROUP_NAME}'))))
    ) and a.account_id=$3::uuid and a.market=$4::varchar and a.currency=$5::varchar
      and a.ticker=$6::varchar and a.asset_type=$13::varchar as matches
    from assets a where a.id=$2::uuid and a.canonical_owner_user_id=$1::uuid
  `, [owner, assetId, input.accountId, input.market, input.currency, input.ticker, input.quantity, input.averageCost, input.reportedReturnPct, input.currentPrice, input.portfolioGroupId, input.newPortfolioGroupName, input.assetType]);
  if (!rows.length) return null;
  return rows[0].matches === true
    ? state("success", "이미 저장한 종목을 확인했습니다.", assetId)
    : state("conflict", "이 목록은 이미 저장되었습니다. 보유 관리에서 변경해 주세요.");
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
    throw new OnboardingPriceUnavailableError("자동 가격 조회를 사용할 수 없습니다. 현재 1주 가격을 직접 입력해 주세요.");
  }

  await enqueueMarketCollection([{ kind: "live", ticker: input.ticker, market: input.market, currency: input.currency }]);
  scheduleMarketCollection();
  throw new OnboardingPriceUnavailableError("가격 확인 요청을 접수했습니다. 잠시 후 다시 저장하거나 현재 1좌 가격을 입력해 주세요.", 10);
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
with prior_holdings as materialized (
  -- The owner lock precedes this statement. Archived holdings count as prior use.
  select count(*) as count from assets where canonical_owner_user_id = $1::uuid
), owned_account as materialized (
  select id, code from accounts
  where id = $3::uuid and canonical_owner_user_id = $1::uuid and is_active = true
    and native_state is null
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
select count(*) as saved_count,
  (select count(*) from accounts where id=$3::uuid and canonical_owner_user_id=$1::uuid and native_state is not null) as native_account_count,
  (count(*) = 1 and (select count from prior_holdings) = 0) as first_holding_created
from inserted_membership
`;
