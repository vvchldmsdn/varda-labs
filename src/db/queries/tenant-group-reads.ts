import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantPortfolioGroupRow = Readonly<{
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  updatedAt: Date;
}>;

export type TenantPortfolioGroupMembershipRow = Readonly<{
  groupId: string;
  targetId: string;
  validFrom: string;
  validTo: string | null;
}>;

export type TenantPortfolioGroupMembershipRows = Readonly<{
  accountMemberships: readonly TenantPortfolioGroupMembershipRow[];
  assetMemberships: readonly TenantPortfolioGroupMembershipRow[];
}>;

export type TenantAllocationGroupRows = Readonly<{
  groups: readonly TenantAllocationGroupRow[];
  members: readonly TenantAllocationGroupMemberRow[];
}>;

export type TenantAllocationGroupRow = Readonly<{
  id: string;
  name: string;
  targetWeight: string | null;
  isActive: boolean;
  sortOrder: number;
}>;

export type TenantAllocationGroupMemberRow = Readonly<{
  groupId: string;
  assetId: string;
  allocationRatio: string | null;
  isActive: boolean;
  sortOrder: number;
}>;

type MembershipMode = "all" | "effective" | "open";

export async function loadActiveTenantPortfolioGroups(
  tenantContext: TenantContext,
): Promise<readonly TenantPortfolioGroupRow[]> {
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [transaction.query(ACTIVE_PORTFOLIO_GROUPS_SQL)],
  );

  return Object.freeze(rows.map(projectPortfolioGroupRow));
}

export async function loadTenantPortfolioGroupMemberships({
  mode,
  portfolioGroupId = null,
  serviceDate = null,
  tenantContext,
}: {
  mode: MembershipMode;
  portfolioGroupId?: string | null;
  serviceDate?: string | null;
  tenantContext: TenantContext;
}): Promise<TenantPortfolioGroupMembershipRows> {
  assertMembershipRequest(mode, serviceDate);
  const parameters = [portfolioGroupId, mode, serviceDate];
  const [accountRows, assetRows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(PORTFOLIO_GROUP_ACCOUNT_MEMBERSHIPS_SQL, parameters),
      transaction.query(PORTFOLIO_GROUP_ASSET_MEMBERSHIPS_SQL, parameters),
    ],
  );

  return Object.freeze({
    accountMemberships: Object.freeze(
      accountRows.map(projectPortfolioGroupMembershipRow),
    ),
    assetMemberships: Object.freeze(
      assetRows.map(projectPortfolioGroupMembershipRow),
    ),
  });
}

export async function loadActiveTenantAllocationGroups(
  tenantContext: TenantContext,
): Promise<readonly TenantAllocationGroupRow[]> {
  const [groupRows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [transaction.query(ACTIVE_LEGACY_ASSET_GROUPS_SQL)],
  );

  return Object.freeze(groupRows.map(projectLegacyAssetGroupRow));
}

export async function loadActiveTenantAllocationGroupBundle(
  tenantContext: TenantContext,
): Promise<TenantAllocationGroupRows> {
  const [groupRows, memberRows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(ACTIVE_LEGACY_ASSET_GROUPS_SQL),
      transaction.query(ACTIVE_LEGACY_ASSET_GROUP_MEMBERS_SQL),
    ],
  );

  return Object.freeze({
    groups: Object.freeze(groupRows.map(projectLegacyAssetGroupRow)),
    members: Object.freeze(memberRows.map(projectLegacyAssetGroupMemberRow)),
  });
}

const ACTIVE_PORTFOLIO_GROUPS_SQL = `
  select
    id::text as id,
    name,
    description,
    sort_order,
    updated_at::text as updated_at
  from public.portfolio_groups
  where archived_at is null
  order by sort_order, name, id
`;

const PORTFOLIO_GROUP_ACCOUNT_MEMBERSHIPS_SQL = `
  select
    portfolio_group_id::text as group_id,
    account_id::text as target_id,
    valid_from::text as valid_from,
    valid_to::text as valid_to
  from public.portfolio_group_account_memberships
  where ($1::uuid is null or portfolio_group_id = $1::uuid)
    and (
      $2::text = 'all'
      or (
        $2::text = 'effective'
        and valid_from <= $3::date
        and (valid_to is null or valid_to > $3::date)
      )
      or (
        $2::text = 'open'
        and (valid_to is null or valid_to > $3::date)
      )
    )
  order by portfolio_group_id, account_id, valid_from
`;

const PORTFOLIO_GROUP_ASSET_MEMBERSHIPS_SQL = `
  select
    portfolio_group_id::text as group_id,
    asset_id::text as target_id,
    valid_from::text as valid_from,
    valid_to::text as valid_to
  from public.portfolio_group_asset_memberships
  where ($1::uuid is null or portfolio_group_id = $1::uuid)
    and (
      $2::text = 'all'
      or (
        $2::text = 'effective'
        and valid_from <= $3::date
        and (valid_to is null or valid_to > $3::date)
      )
      or (
        $2::text = 'open'
        and (valid_to is null or valid_to > $3::date)
      )
    )
  order by portfolio_group_id, asset_id, valid_from
`;

const ACTIVE_LEGACY_ASSET_GROUPS_SQL = `
  select
    id::text as id,
    name,
    target_weight::text as target_weight,
    is_active,
    sort_order
  from public.asset_groups
  where is_active = true
  order by sort_order, name, id
`;

const ACTIVE_LEGACY_ASSET_GROUP_MEMBERS_SQL = `
  select
    member.group_id::text as group_id,
    member.asset_id::text as asset_id,
    member.allocation_ratio::text as allocation_ratio,
    member.sort_order,
    member.is_active
  from public.asset_group_members as member
  inner join public.asset_groups as asset_group
    on asset_group.id = member.group_id
  where member.is_active = true
    and asset_group.is_active = true
  order by member.group_id, member.sort_order, member.asset_id
`;

function projectPortfolioGroupRow(
  row: Record<string, unknown>,
): TenantPortfolioGroupRow {
  return Object.freeze({
    id: requiredString(row.id),
    name: requiredString(row.name),
    description: nullableString(row.description),
    sortOrder: requiredInteger(row.sort_order),
    updatedAt: requiredTimestamp(row.updated_at),
  });
}

function projectPortfolioGroupMembershipRow(
  row: Record<string, unknown>,
): TenantPortfolioGroupMembershipRow {
  return Object.freeze({
    groupId: requiredString(row.group_id),
    targetId: requiredString(row.target_id),
    validFrom: requiredDate(row.valid_from),
    validTo: nullableDate(row.valid_to),
  });
}

function projectLegacyAssetGroupRow(
  row: Record<string, unknown>,
): TenantAllocationGroupRow {
  return Object.freeze({
    id: requiredString(row.id),
    name: requiredString(row.name),
    targetWeight: nullableString(row.target_weight),
    isActive: requiredBoolean(row.is_active),
    sortOrder: requiredInteger(row.sort_order),
  });
}

function projectLegacyAssetGroupMemberRow(
  row: Record<string, unknown>,
): TenantAllocationGroupMemberRow {
  return Object.freeze({
    groupId: requiredString(row.group_id),
    assetId: requiredString(row.asset_id),
    allocationRatio: nullableString(row.allocation_ratio),
    sortOrder: requiredInteger(row.sort_order),
    isActive: requiredBoolean(row.is_active),
  });
}

function assertMembershipRequest(
  mode: MembershipMode,
  serviceDate: string | null,
) {
  if (mode === "all") return;
  if (serviceDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    throw new Error("Tenant portfolio group membership request is invalid");
  }
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant group row is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}

function requiredInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tenant group row is invalid");
  }
  return parsed;
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Tenant group row is invalid");
  }
  return value;
}

function requiredTimestamp(value: unknown) {
  const parsed = new Date(requiredString(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Tenant group row is invalid");
  }
  return parsed;
}

function requiredDate(value: unknown) {
  const date = requiredString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Tenant group row is invalid");
  }
  return date;
}

function nullableDate(value: unknown) {
  return value === null ? null : requiredDate(value);
}
