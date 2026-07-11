import {
  INVESTMENT_LAB_DERIVED_ALL_PATH_SQL,
  INVESTMENT_LAB_EVENT_FLOW_SQL,
  INVESTMENT_LAB_KODEX_CLOSE_SQL,
  INVESTMENT_LAB_SNAPSHOT_BOUNDARY_SQL,
} from "./investment-lab-event-flow-sql.mjs";

export async function loadInvestmentLabEventFlowEvidence(sql) {
  const [eventRows, closeRows, snapshotRows, actualPathRows] = await Promise.all([
    sql.query(INVESTMENT_LAB_EVENT_FLOW_SQL),
    sql.query(INVESTMENT_LAB_KODEX_CLOSE_SQL),
    sql.query(INVESTMENT_LAB_SNAPSHOT_BOUNDARY_SQL),
    sql.query(INVESTMENT_LAB_DERIVED_ALL_PATH_SQL),
  ]);

  return {
    eventRows,
    closeRows,
    snapshot: snapshotRows[0] ?? {},
    actualPathRows,
  };
}
