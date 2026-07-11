import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  ProvisioningArgumentError,
  blockedProvisioningOutput,
  buildInitialProvisioningPlan,
  parseProvisioningArgs,
} from "./lib/initial-app-user-provisioning.mjs";
import {
  PROVISIONING_ADVISORY_LOCK_NAME,
  PROVISIONING_ADVISORY_LOCK_SQL,
  buildActualProvisioningOutput,
  buildLockedProvisioningQuery,
} from "./lib/initial-app-user-write.mjs";
import { readInitialProvisioningState } from "./lib/initial-app-user-state.mjs";
import { USER_OWNED_TABLE_NAMES } from "./lib/tenant-ownership-policy.mjs";

config({ path: ".env.local", quiet: true });

await main();

async function main() {
  let args;
  try {
    args = parseProvisioningArgs(process.argv.slice(2));
  } catch (error) {
    const blocker =
      error instanceof ProvisioningArgumentError
        ? error.code
        : "invalid_arguments";
    print(blockedProvisioningOutput(blocker));
    process.exitCode = 1;
    return;
  }

  const databaseUrl =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    print(blockedProvisioningOutput("database_not_configured"));
    process.exitCode = 1;
    return;
  }

  try {
    const sql = neon(databaseUrl);
    const state = await readInitialProvisioningState(sql);
    const plan = buildInitialProvisioningPlan({
      initialOwnerId: args.initialOwnerId,
      state,
    });

    if (!args.write) {
      print(plan);
      if (plan.result === "blocked") process.exitCode = 1;
      return;
    }

    if (plan.result !== "planned_insert") {
      print(
        Object.freeze({
          ...plan,
          mode: "write",
          warnings: Object.freeze([]),
        }),
      );
      if (plan.result === "blocked") process.exitCode = 1;
      return;
    }

    const insertQuery = buildLockedProvisioningQuery(
      args.initialOwnerId,
      USER_OWNED_TABLE_NAMES,
    );
    const results = await sql.transaction((txn) => [
      txn.query("set local lock_timeout = '5s'"),
      txn.query("set local statement_timeout = '30s'"),
      txn.query(PROVISIONING_ADVISORY_LOCK_SQL, [
        PROVISIONING_ADVISORY_LOCK_NAME,
      ]),
      txn.query(insertQuery.text, insertQuery.params),
    ]);
    const lockedState = results[3]?.[0];

    if (!lockedState) {
      print(blockedProvisioningOutput("locked_state_unavailable"));
      process.exitCode = 1;
      return;
    }

    const output = buildActualProvisioningOutput(plan, lockedState);
    print(output);
    if (output.result === "blocked") process.exitCode = 1;
  } catch {
    print(blockedProvisioningOutput("database_preflight_failed"));
    process.exitCode = 1;
  }
}

function print(output) {
  console.log(JSON.stringify(output, null, 2));
}
