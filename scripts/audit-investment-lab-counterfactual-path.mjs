import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { auditInvestmentLabCounterfactualPathEvidence } from "./lib/investment-lab-counterfactual-path-audit.mjs";
import {
  loadInvestmentLabActiveOwners,
  loadInvestmentLabEventFlowEvidence,
} from "./lib/investment-lab-event-flow-data.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const owners = await loadInvestmentLabActiveOwners(sql);
const audits = await Promise.all(
  owners.map(async (owner) =>
    auditInvestmentLabCounterfactualPathEvidence(
      await loadInvestmentLabEventFlowEvidence(sql, owner.owner_user_id),
    ),
  ),
);
const result = {
  audit: "investment_lab_aggregate_kodex200_counterfactual_path_by_owner",
  status:
    audits.length > 0 && audits.every((audit) => audit.status === "passed")
      ? "passed"
      : "blocked",
  readOnly: true,
  ownerCount: audits.length,
  owners: audits.map((audit, index) => ({
    ownerOrdinal: index + 1,
    result: audit,
  })),
};

console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
