import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  IdentityBootstrapClaimIssuerArgumentError,
  blockedIdentityBootstrapClaimIssuerOutput,
  buildIdentityBootstrapClaimIssueOutput,
  buildIdentityBootstrapClaimIssuerPlan,
  createOneTimeIdentityBootstrapClaim,
  parseIdentityBootstrapClaimIssuerArgs,
} from "./lib/identity-bootstrap-claim-issuer.mjs";
import { readIdentityBootstrapClaimIssuerState } from "./lib/identity-bootstrap-claim-issuer-state.mjs";
import {
  IdentityBootstrapClaimIssuerTargetError,
  guardIdentityBootstrapClaimIssuerTarget,
} from "./lib/identity-bootstrap-claim-issuer-target.mjs";
import { buildIdentityBootstrapClaimIssueQueries } from "./lib/identity-bootstrap-claim-issuer-write.mjs";

config({ path: ".env.local", quiet: true });

await main();

async function main() {
  let args;
  try {
    args = parseIdentityBootstrapClaimIssuerArgs(process.argv.slice(2));
  } catch (error) {
    const blocker =
      error instanceof IdentityBootstrapClaimIssuerArgumentError
        ? error.code
        : "invalid_arguments";
    print(blockedIdentityBootstrapClaimIssuerOutput(blocker));
    process.exitCode = 1;
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const databaseUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;

  try {
    let targetEvidence;
    try {
      targetEvidence = guardIdentityBootstrapClaimIssuerTarget({
        databaseUrl,
        databaseUrlUnpooled,
        targetAppUserId: args.targetAppUserId,
        reviewedTargetFingerprint: args.reviewedTargetFingerprint,
      });
    } catch (error) {
      const blocker =
        error instanceof IdentityBootstrapClaimIssuerTargetError
          ? error.code
          : "issuer_database_target_invalid";
      print(
        blockedIdentityBootstrapClaimIssuerOutput(
          blocker,
          args.write ? "write" : "dry_run",
        ),
      );
      process.exitCode = 1;
      return;
    }

    const sql = neon(databaseUrlUnpooled);
    const state = await readIdentityBootstrapClaimIssuerState(
      sql,
      args.targetAppUserId,
    );
    const plan = buildIdentityBootstrapClaimIssuerPlan({
      targetAppUserId: args.targetAppUserId,
      state,
      targetEvidence,
    });

    if (!args.write) {
      print(plan);
      if (plan.result === "blocked") process.exitCode = 1;
      return;
    }
    if (plan.result !== "ready") {
      print(Object.freeze({ ...plan, mode: "write", warnings: [] }));
      process.exitCode = 1;
      return;
    }

    const oneTimeClaim = createOneTimeIdentityBootstrapClaim();
    const issueQueries = buildIdentityBootstrapClaimIssueQueries({
      targetAppUserId: args.targetAppUserId,
      claimDigest: oneTimeClaim.claimDigest,
    });
    const results = await sql.transaction((transaction) => [
      transaction.query("set local lock_timeout = '5s'"),
      transaction.query("set local statement_timeout = '30s'"),
      transaction.query(
        issueQueries.targetLock.text,
        issueQueries.targetLock.params,
      ),
      transaction.query(issueQueries.issue.text, issueQueries.issue.params),
    ]);
    const lockedState = results[3]?.[0];
    const output = buildIdentityBootstrapClaimIssueOutput({
      plan,
      lockedState,
      rawClaim: oneTimeClaim.rawClaim,
    });

    print(output);
    if (output.result !== "issued") process.exitCode = 1;
  } catch {
    print(blockedIdentityBootstrapClaimIssuerOutput("claim_issue_failed"));
    process.exitCode = 1;
  }
}

function print(output) {
  console.log(JSON.stringify(output, null, 2));
}
