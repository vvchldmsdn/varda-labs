import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { auditInvestmentLabEventFlowEvidence } from "./lib/investment-lab-event-flow-audit.mjs";
import { loadInvestmentLabEventFlowEvidence } from "./lib/investment-lab-event-flow-data.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const evidence = await loadInvestmentLabEventFlowEvidence(sql);
const result = auditInvestmentLabEventFlowEvidence(evidence);

console.log(JSON.stringify(result, null, 2));
