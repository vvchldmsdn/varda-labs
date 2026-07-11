import {
  TARGET_POLICY_ASSETS_SQL,
  TARGET_POLICY_GROUPS_SQL,
  TARGET_POLICY_MEMBERS_SQL,
  TARGET_POLICY_ROW_COUNTS_SQL,
} from "./target-policy-evidence-sql.mjs";

export async function loadTargetPolicyEvidence(sql) {
  const [assets, groups, members] = await Promise.all([
    sql.query(TARGET_POLICY_ASSETS_SQL),
    sql.query(TARGET_POLICY_GROUPS_SQL),
    sql.query(TARGET_POLICY_MEMBERS_SQL),
  ]);

  return { assets, groups, members };
}

export async function loadTargetPolicyRowCounts(sql) {
  const [row] = await sql.query(TARGET_POLICY_ROW_COUNTS_SQL);
  return normalizeRowCounts(row);
}

function normalizeRowCounts(row = {}) {
  return Object.freeze({
    assets: number(row.assets),
    assetGroups: number(row.asset_groups),
    assetGroupMembers: number(row.asset_group_members),
  });
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
