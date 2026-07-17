import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { loadInvestmentLabLegacyReconstructionCandidateEvidence } from "./lib/investment-lab-legacy-reconstruction-candidate-data.mjs";
import { buildInvestmentLabLegacyReconstructionCandidateReport } from "./lib/investment-lab-legacy-reconstruction-candidate-report.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const evidence = await loadInvestmentLabLegacyReconstructionCandidateEvidence(sql);
const report = buildInvestmentLabLegacyReconstructionCandidateReport(evidence);

console.log(JSON.stringify(report, null, 2));
