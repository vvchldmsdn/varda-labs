import {
  FX_EVIDENCE_SQL,
  PRICE_EVIDENCE_SQL,
  SNAPSHOT_EVIDENCE_SQL,
  TRADE_EVIDENCE_SQL,
} from "./investment-lab-counterfactual-sql.mjs";

export async function loadInvestmentLabCounterfactualEvidence(sql) {
  const [snapshotRows, tradeRows, priceRows, fxRows] = await Promise.all([
    sql.query(SNAPSHOT_EVIDENCE_SQL),
    sql.query(TRADE_EVIDENCE_SQL),
    sql.query(PRICE_EVIDENCE_SQL),
    sql.query(FX_EVIDENCE_SQL),
  ]);

  return { snapshotRows, tradeRows, priceRows, fxRows };
}
