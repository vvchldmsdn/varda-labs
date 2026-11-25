import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "../src/lib/deployment/preview-database-target.ts";
import { assertPreviewReleaseCatalog, readPreviewReleaseCatalog } from "./lib/preview-release-catalog.mjs";

export const realizedReviewMigration = "0070_account_realized_profit_reviews";
export async function verifyRealizedReviewSchema(query, installed) {
  if (!installed) {
    const [row] = await query("select to_regclass('public.account_realized_profit_reviews') is null as absent");
    assert.equal(row.absent, true, "unexpected_realized_review_table");
    return;
  }
  const expected = JSON.parse(readFileSync(new URL("./fixtures/broker-realized-release-catalog.json", import.meta.url), "utf8"));
  assertPreviewReleaseCatalog(await readPreviewReleaseCatalog(query, true), expected);
}

export async function migrateBrokerRealizedStatements(client, apply = false) {
  const sql = readFileSync(new URL("../drizzle/" + realizedReviewMigration + ".sql", import.meta.url), "utf8");
  const artifact = PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration;
  assert.equal(artifact.tag, realizedReviewMigration);
  assert.equal(createHash("sha256").update(sql).digest("hex"), artifact.sha256);
  const previous = PREVIEW_DATABASE_TARGET_GUARD_POLICY.allowedPendingMigrations.find(entry => entry.tag === "0069_reviewed_identity_native_rebuy");
  await client.query(apply ? "begin" : "begin isolation level repeatable read read only");
  try {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");
    await client.query("set local search_path = public, pg_catalog");
    if (apply) await client.query("lock table drizzle.__drizzle_migrations in share row exclusive mode");
    const read = async text => (await client.query(text)).rows;
    const [last] = await read("select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1");
    const installed = last?.hash === artifact.sha256 && Number(last.created_at) === artifact.createdAt;
    if (!installed && (last?.hash !== previous?.sha256 || Number(last?.created_at) !== previous.createdAt))
      throw new Error("unexpected_schema_frontier");
    await verifyRealizedReviewSchema(read, installed);
    if (apply && !installed) {
      await client.query(sql);
      await verifyRealizedReviewSchema(read, true);
      await client.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ($1,$2)", [artifact.sha256, artifact.createdAt]);
    }
    await client.query("commit");
    return { migration: artifact.tag, sha256: artifact.sha256, status: installed ? "already_applied" : apply ? "applied" : "ready" };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let client;
  try {
    const mode = process.argv[2] ?? "--check";
    if (process.argv.length > 3 || !["--check","--apply"].includes(mode)) throw new Error("invalid_mode");
    guardProductionDatabaseTarget(process.env);
    client = new Client({connectionString: process.env.DATABASE_URL_UNPOOLED, connectionTimeoutMillis: 15000});
    await client.connect();
    console.log(JSON.stringify(await migrateBrokerRealizedStatements(client, mode === "--apply")));
  } catch (error) {
    console.error(String(error.message).startsWith("Preview schema evidence differs") ? error.message : "realized_review_migration_failed");
    process.exitCode = 1;
  } finally {
    await client?.end();
  }
}
