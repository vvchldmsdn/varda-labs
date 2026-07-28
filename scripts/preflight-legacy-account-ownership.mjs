import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { LEGACY_EXCLUDED_USER_TABLE_NAMES } from "./lib/tenant-ownership-policy.mjs";
import {
  LegacyAccountOwnershipArgumentError,
  buildLegacyAccountOwnershipDiscovery,
  buildLegacyAccountOwnershipPreflight,
  parseLegacyAccountOwnershipArgs,
} from "./lib/legacy-account-ownership-preflight.mjs";

config({ path: ".env.local", quiet: true });

await main();

async function main() {
  let args;
  try {
    args = parseLegacyAccountOwnershipArgs(process.argv.slice(2));
  } catch (error) {
    printBlocked(
      error instanceof LegacyAccountOwnershipArgumentError
        ? error.code
        : "invalid_arguments",
    );
    return;
  }

  const databaseUrl =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    printBlocked("database_not_configured");
    return;
  }

  try {
    const sql = neon(databaseUrl);
    const [appUsers, accounts] = await sql.transaction(
      (transaction) => [
        transaction.query(`
          select id::text as id, status, role
          from app_users
          order by id
        `),
        transaction.query(`
          select
            id::text as id,
            owner_user_id as "legacyOwnerUserId",
            canonical_owner_user_id::text as "canonicalOwnerUserId"
          from accounts
          order by id
        `),
      ],
      {
        isolationLevel: "RepeatableRead",
        readOnly: true,
      },
    );

    const output =
      args.mode === "discover"
        ? buildLegacyAccountOwnershipDiscovery({ appUsers, accounts })
        : buildLegacyAccountOwnershipPreflight({
            appUsers,
            accounts,
            targetAppUserSha256: args.targetAppUserSha256,
            legacyOwnerSha256: args.legacyOwnerSha256,
            intentionallySkippedTables: LEGACY_EXCLUDED_USER_TABLE_NAMES,
          });

    console.log(JSON.stringify(output, null, 2));
    if (output.result === "blocked") process.exitCode = 1;
  } catch {
    printBlocked("database_preflight_failed");
  }
}

function printBlocked(blocker) {
  console.log(
    JSON.stringify(
      {
        operation: "legacy_account_ownership_evidence_preflight_v1",
        mode: "preflight",
        result: "blocked",
        readOnly: true,
        databaseSideEffects: false,
        blockers: [blocker],
        plannedWrites: {
          appUsers: 0,
          authIdentities: 0,
          accounts: 0,
          otherProductTables: 0,
        },
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
