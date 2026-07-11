import {
  TARGET_POLICY_HOLDING_UNIVERSE_ROW_COUNT_SQL,
  TARGET_POLICY_HOLDING_UNIVERSE_SQL,
} from "./target-policy-holding-universe-sql.mjs";

export async function loadTargetPolicyHoldingUniverse(sql, account) {
  return sql.query(TARGET_POLICY_HOLDING_UNIVERSE_SQL, [account]);
}

export async function loadTargetPolicyHoldingUniverseRowCount(sql) {
  const [row] = await sql.query(TARGET_POLICY_HOLDING_UNIVERSE_ROW_COUNT_SQL);
  const count = Number(row?.assets);
  return Number.isFinite(count) ? count : 0;
}
