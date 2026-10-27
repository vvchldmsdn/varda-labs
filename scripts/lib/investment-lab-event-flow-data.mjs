import {
  INVESTMENT_LAB_ACTIVE_OWNER_SQL,
  INVESTMENT_LAB_DERIVED_ALL_PATH_SQL,
  INVESTMENT_LAB_EVENT_FLOW_SQL,
  INVESTMENT_LAB_KODEX_CLOSE_SQL,
  INVESTMENT_LAB_SNAPSHOT_BOUNDARY_SQL,
} from "./investment-lab-event-flow-sql.mjs";

export async function loadInvestmentLabActiveOwners(sql) {
  return sql.query(INVESTMENT_LAB_ACTIVE_OWNER_SQL);
}

export async function loadInvestmentLabEventFlowEvidence(sql, ownerUserId) {
  if (!ownerUserId) throw new Error("ownerUserId is required");

  const [eventRows, closeRows, snapshotRows, actualPathRows] =
    await Promise.all([
      sql.query(INVESTMENT_LAB_EVENT_FLOW_SQL, [ownerUserId]),
      sql.query(INVESTMENT_LAB_KODEX_CLOSE_SQL),
      sql.query(INVESTMENT_LAB_SNAPSHOT_BOUNDARY_SQL, [ownerUserId]),
      sql.query(INVESTMENT_LAB_DERIVED_ALL_PATH_SQL, [ownerUserId]),
    ]);

  return {
    eventRows,
    closeRows,
    snapshot: snapshotRows[0] ?? {},
    actualPathRows,
    ownerRows: [{ owner_user_id: ownerUserId }],
  };
}
