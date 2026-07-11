import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { auditTargetPolicyEvidence } from "./lib/target-policy-evidence-audit.mjs";
import {
  loadTargetPolicyEvidence,
  loadTargetPolicyRowCounts,
} from "./lib/target-policy-evidence-data.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const beforeRowCounts = await loadTargetPolicyRowCounts(sql);
  const evidence = await loadTargetPolicyEvidence(sql);
  const afterRowCounts = await loadTargetPolicyRowCounts(sql);
  const result = auditTargetPolicyEvidence({
    evidence,
    beforeRowCounts,
    afterRowCounts,
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
