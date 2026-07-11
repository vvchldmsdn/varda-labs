import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { auditInvestmentLabCounterfactualEvidence } from "./lib/investment-lab-counterfactual-audit.mjs";
import { loadInvestmentLabCounterfactualEvidence } from "./lib/investment-lab-counterfactual-data.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const evidence = await loadInvestmentLabCounterfactualEvidence(sql);
const result = auditInvestmentLabCounterfactualEvidence(evidence);

console.log(JSON.stringify(result, null, 2));
