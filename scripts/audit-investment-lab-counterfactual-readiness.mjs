import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { auditInvestmentLabCounterfactualEvidence } from "./lib/investment-lab-counterfactual-audit.mjs";
import {
  loadInvestmentLabCounterfactualActiveOwners,
  loadInvestmentLabCounterfactualEvidence,
} from "./lib/investment-lab-counterfactual-data.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const owners = await loadInvestmentLabCounterfactualActiveOwners(sql);
const audits = await Promise.all(
  owners.map(async (owner) =>
    auditInvestmentLabCounterfactualEvidence(
      await loadInvestmentLabCounterfactualEvidence(sql, owner.owner_user_id),
    ),
  ),
);
const result = {
  audit: "investment_lab_historical_counterfactual_readiness_by_owner",
  status: audits.length > 0 ? "passed" : "blocked",
  readOnly: true,
  ownerCount: audits.length,
  owners: audits.map((audit, index) => ({
    ownerOrdinal: index + 1,
    result: audit,
  })),
};

console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
