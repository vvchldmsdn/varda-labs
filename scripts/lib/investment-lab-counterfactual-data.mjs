import {
  FX_EVIDENCE_SQL,
  PRICE_EVIDENCE_SQL,
  SNAPSHOT_EVIDENCE_SQL,
  TRADE_EVIDENCE_SQL,
} from "./investment-lab-counterfactual-sql.mjs";
import { INVESTMENT_LAB_ACTIVE_OWNER_SQL } from "./investment-lab-event-flow-sql.mjs";

export async function loadInvestmentLabCounterfactualActiveOwners(sql) {
  return sql.query(INVESTMENT_LAB_ACTIVE_OWNER_SQL);
}

export async function loadInvestmentLabCounterfactualEvidence(sql, ownerUserId) {
  if (!ownerUserId) throw new Error("ownerUserId is required");

  const [snapshotRows, tradeRows, priceRows, fxRows] = await Promise.all([
    sql.query(SNAPSHOT_EVIDENCE_SQL, [ownerUserId]),
    sql.query(TRADE_EVIDENCE_SQL, [ownerUserId]),
    sql.query(PRICE_EVIDENCE_SQL, [ownerUserId]),
    sql.query(FX_EVIDENCE_SQL),
  ]);

  return { snapshotRows, tradeRows, priceRows, fxRows };
}
