import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";

type Membership = { targetId: string; validFrom: string; validTo: string | null };
export type NativeGroupSelection = {
  wholeAccountIds: readonly string[];
  directAssetIds: readonly string[];
  /** Only compare frames within the current membership window. Never backcast today's members. */
  stableSince: string;
};

export function resolveNativeGroupSelection(rows: { accountMemberships: readonly Membership[]; assetMemberships: readonly Membership[] }, asOf: string): NativeGroupSelection {
  const day = resolveSnapshotCycle(new Date(asOf)).snapshotDate;
  const all = [...rows.accountMemberships, ...rows.assetMemberships];
  if (all.some(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.validFrom) || (row.validTo !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(row.validTo) || row.validTo <= row.validFrom)))) throw new Error("native_group_membership_invalid");
  const active = (row: Membership) => row.validFrom <= day && (row.validTo === null || row.validTo > day);
  const lastChange = all.flatMap(row => [row.validFrom, ...(row.validTo ? [row.validTo] : [])]).filter(date => date <= day).sort().at(-1) ?? day;
  return {
    wholeAccountIds: [...new Set(rows.accountMemberships.filter(active).map(row => row.targetId))],
    directAssetIds: [...new Set(rows.assetMemberships.filter(active).map(row => row.targetId))],
    stableSince: new Date(`${lastChange}T07:00:00+09:00`).toISOString(),
  };
}
