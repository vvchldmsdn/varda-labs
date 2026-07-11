export const TARGET_POLICY_ACCOUNTS = Object.freeze([
  "brokerage",
  "isa",
  "irp",
] as const);

export type TargetPolicyAccount = (typeof TARGET_POLICY_ACCOUNTS)[number];

export type TargetPolicyAssetEvidence = Readonly<{
  ref: string;
  account: string;
  market: string;
  currency: string;
  ticker: string | null;
  targetWeight: string | number | null;
  directGroupRef: string | null;
}>;

export type TargetPolicyGroupEvidence = Readonly<{
  ref: string;
  targetWeight: string | number | null;
  executionMode: string;
  isActive: boolean;
}>;

export type TargetPolicyMemberEvidence = Readonly<{
  groupRef: string;
  assetRef: string;
  allocationRatio: string | number | null;
  priority: number | null;
  isActive: boolean;
}>;

export type NormalizedTargetPolicyAsset = Omit<
  TargetPolicyAssetEvidence,
  "account" | "market" | "currency" | "ticker" | "targetWeight" | "directGroupRef"
> & {
  account: TargetPolicyAccount | null;
  market: string;
  currency: string;
  ticker: string | null;
  targetWeight: number | null;
  directGroupRef: string | null;
};

export type NormalizedTargetPolicyGroup = Omit<
  TargetPolicyGroupEvidence,
  "targetWeight" | "executionMode"
> & {
  targetWeight: number | null;
  executionMode: string;
};

export type NormalizedTargetPolicyMember = Omit<
  TargetPolicyMemberEvidence,
  "allocationRatio"
> & {
  allocationRatio: number | null;
};

export function normalizeTargetPolicyEvidenceInput(input: {
  assets: readonly TargetPolicyAssetEvidence[];
  groups: readonly TargetPolicyGroupEvidence[];
  members: readonly TargetPolicyMemberEvidence[];
}) {
  return {
    assets: input.assets.map(normalizeAsset),
    groups: input.groups.map(normalizeGroup),
    members: input.members.map(normalizeMember),
  };
}

function normalizeAsset(
  asset: TargetPolicyAssetEvidence,
): NormalizedTargetPolicyAsset {
  return {
    ...asset,
    ref: String(asset.ref ?? "").trim(),
    account: normalizeAccount(asset.account),
    market: String(asset.market ?? "").trim().toLowerCase(),
    currency: String(asset.currency ?? "").trim().toUpperCase(),
    ticker: normalizeNullable(asset.ticker)?.toUpperCase() ?? null,
    targetWeight: numberOrNull(asset.targetWeight),
    directGroupRef: normalizeNullable(asset.directGroupRef),
  };
}

function normalizeGroup(
  group: TargetPolicyGroupEvidence,
): NormalizedTargetPolicyGroup {
  return {
    ...group,
    ref: String(group.ref ?? "").trim(),
    targetWeight: numberOrNull(group.targetWeight),
    executionMode: String(group.executionMode ?? "").trim().toLowerCase(),
  };
}

function normalizeMember(
  member: TargetPolicyMemberEvidence,
): NormalizedTargetPolicyMember {
  return {
    ...member,
    groupRef: String(member.groupRef ?? "").trim(),
    assetRef: String(member.assetRef ?? "").trim(),
    allocationRatio: numberOrNull(member.allocationRatio),
  };
}

function normalizeAccount(value: string): TargetPolicyAccount | null {
  const account = String(value ?? "").trim().toLowerCase();
  return TARGET_POLICY_ACCOUNTS.includes(account as TargetPolicyAccount)
    ? (account as TargetPolicyAccount)
    : null;
}

function normalizeNullable(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function numberOrNull(value: string | number | null) {
  if (value === null || value === "") return null;
  return Number(value);
}
