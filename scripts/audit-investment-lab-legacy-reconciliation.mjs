import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { loadInvestmentLabLegacyReconciliationEvidence } from "./lib/investment-lab-legacy-reconciliation-data.mjs";
import { buildInvestmentLabLegacyReconciliationReport } from "./lib/investment-lab-legacy-reconciliation-report.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const evidence = await loadInvestmentLabLegacyReconciliationEvidence(sql);
const report = buildInvestmentLabLegacyReconciliationReport(evidence);

console.log(JSON.stringify(report, null, 2));
