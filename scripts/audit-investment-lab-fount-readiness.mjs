import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/investment-lab-special-holding-authority.ts";
import { loadInvestmentLabFountReadinessEvidence } from "./lib/investment-lab-fount-readiness-data.mjs";
import { buildInvestmentLabFountReadinessReport } from "./lib/investment-lab-fount-readiness-report.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const decision =
  DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
const evidence = await loadInvestmentLabFountReadinessEvidence(sql, decision);
const report = buildInvestmentLabFountReadinessReport({ decision, evidence });

console.log(JSON.stringify(report, null, 2));
