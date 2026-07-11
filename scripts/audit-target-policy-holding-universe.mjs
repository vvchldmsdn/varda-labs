import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { auditTargetPolicyHoldingUniverses } from "./lib/target-policy-holding-universe-audit.mjs";
import {
  loadTargetPolicyHoldingUniverse,
  loadTargetPolicyHoldingUniverseRowCount,
} from "./lib/target-policy-holding-universe-data.mjs";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);
const ACCOUNTS = ["brokerage", "isa", "irp"];

async function main() {
  const beforeRowCount = await loadTargetPolicyHoldingUniverseRowCount(sql);
  const holdingRows = await Promise.all(
    ACCOUNTS.map((account) => loadTargetPolicyHoldingUniverse(sql, account)),
  );
  const afterRowCount = await loadTargetPolicyHoldingUniverseRowCount(sql);
  const holdingsByAccount = Object.fromEntries(
    ACCOUNTS.map((account, index) => [account, holdingRows[index]]),
  );
  const result = auditTargetPolicyHoldingUniverses({
    holdingsByAccount,
    beforeRowCount,
    afterRowCount,
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
