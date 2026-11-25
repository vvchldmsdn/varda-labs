import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "../src/lib/deployment/preview-database-target.ts";
import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";

const publication = "0068_reviewed_archived_asset_identity";
const migration = "0069_reviewed_identity_native_rebuy";
const publicationHash = "f7939adf0459c4a8c50ef8eeb3f607eb1c869f1a521ae1baa3e21448fd67dba1";
const readMigration = tag => readFileSync(new URL("../drizzle/" + tag + ".sql", import.meta.url), "utf8");
const digest = value => createHash("sha256").update(value).digest("hex");

function expectedBody(sql) {
  const result = sql.match(/FUNCTION (?:public\.)?guard_native_asset_lifecycle\(\) RETURNS trigger[\s\S]*?AS \$\$([\s\S]*?)\$\$;/i);
  if (!result) throw new Error("missing_guard_definition");
  return result[1].replaceAll("\r\n", "\n");
}

async function verifyGuard(client, expected) {
  const { rows } = await client.query(`select p.prosrc as body,
      not p.prosecdef and p.proconfig @> ARRAY['search_path=pg_catalog, public']
      and t.tgenabled='O' and t.tgtype=29 and t.tgdeferrable and t.tginitdeferred as valid
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.assets'::regclass and t.tgname='native_asset_lifecycle_guard'
      and p.oid='public.guard_native_asset_lifecycle()'::regprocedure`);
  if (!rows[0]?.valid || rows[0].body.replaceAll("\r\n", "\n") !== expected) throw new Error("lifecycle_guard_mismatch");
}

export async function verifyPublishedIdentityGuard(client, tag) {
  const definitions = {
    "0067_daily_valuation_fx": "0052_native_legacy_lifecycle_guard",
    [publication]: publication,
    [migration]: migration,
  };
  if (!Object.hasOwn(definitions, tag)) throw new Error("migration_frontier_mismatch");
  await verifyGuard(client, expectedBody(readMigration(definitions[tag])));
}

export async function migrateReviewedArchivedIdentity(client, mode = "check") {
  if (mode !== "check" && mode !== "apply") throw new Error("invalid_release_mode");
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries;
  const entry = journal.find(item => item.tag === migration);
  const first = journal[entry.idx - 1];
  const previous = journal[first.idx - 1];
  const sql = readMigration(migration);
  const publicationSql = readMigration(publication);
  const hash = digest(sql);
  const reviewed = PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration;
  if (reviewed.tag !== migration || reviewed.createdAt !== entry.when || reviewed.sha256 !== hash ||
      first.tag !== publication || digest(publicationSql) !== publicationHash || previous.tag !== "0067_daily_valuation_fx") {
    throw new Error("release_artifact_mismatch");
  }

  await client.query(mode === "check" ? "begin isolation level repeatable read read only" : "begin");
  try {
    await client.query("set local lock_timeout='5s'");
    await client.query("set local statement_timeout='30s'");
    if (mode === "apply") {
      await client.query("select pg_advisory_xact_lock(hashtextextended('cairn.release.reviewed-identity.v1',0))");
      await client.query("lock table drizzle.__drizzle_migrations in share row exclusive mode");
    }
    const latest = (await client.query("select hash,created_at from drizzle.__drizzle_migrations order by created_at desc limit 1")).rows[0];
    const installed = Number(latest?.created_at) === entry.when && latest.hash === hash;
    const hasPublication = Number(latest?.created_at) === first.when && latest.hash === publicationHash;
    if (!installed && !hasPublication && (Number(latest?.created_at) !== previous.when || latest.hash !== digest(readMigration(previous.tag)))) {
      throw new Error("migration_frontier_mismatch");
    }
    await verifyPublishedIdentityGuard(client, installed ? migration : hasPublication ? publication : previous.tag);
    if (!installed && mode === "apply") {
      if (!hasPublication) {
        await client.query(publicationSql);
        await client.query("insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)", [publicationHash,first.when]);
        await verifyGuard(client, expectedBody(publicationSql));
      }
      await client.query(sql);
      await client.query("insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)", [hash,entry.when]);
      await verifyGuard(client, expectedBody(sql));
    }
    await client.query("commit");
    return { migration, sha256: hash, status: installed ? "already_applied" : mode === "apply" ? "applied" : "ready" };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let client;
  try {
    const mode = process.argv[2] ?? "--check";
    if (process.argv.length > 3 || !["--check","--apply"].includes(mode)) throw new Error("invalid_release_mode");
    guardProductionDatabaseTarget(process.env);
    client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED, connectionTimeoutMillis: 15000 });
    await client.connect();
    console.log(JSON.stringify(await migrateReviewedArchivedIdentity(client, mode.slice(2))));
  } catch (error) {
    const known = ["invalid_release_mode","lifecycle_guard_mismatch","migration_frontier_mismatch","release_artifact_mismatch"];
    console.error(known.includes(error?.message) ? error.message : "release_target_or_database_unavailable");
    process.exitCode = 1;
  } finally {
    await client?.end();
  }
}
