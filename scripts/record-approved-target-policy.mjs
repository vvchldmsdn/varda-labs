import { readFile } from "node:fs/promises";
import path from "node:path";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import { guardPreviewDatabaseTarget } from "../src/lib/deployment/preview-database-target.ts";
import { buildTargetPolicyHoldingUniverse } from "../src/lib/target-policy-holding-universe.ts";
import { buildTargetPolicyReviewPacket } from "../src/lib/target-policy-review-packet.ts";

const POLICY_ID = "account_scoped_explicit_instrument_targets_v1";
const AUDIT_VERSION = "target_policy_approval_audit_v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SENSITIVE_KEY_PATTERN = /(token|secret|password|api[_-]?key|authorization)/i;

config({ path: ".env.local", quiet: true });

await main();

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const payload = validatePayload(
      JSON.parse(await readFile(path.resolve(args.file), "utf8")),
    );
    const databaseUrl =
      process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("database_not_configured");

    const target = guardDatabaseTarget(args.target, process.env);
    const sql = neon(databaseUrl);
    const account = await resolveOwnedAccount(sql, payload, args.ownerUserId);
    const evidence = await readAndValidateEvidence(sql, account, payload);
    const existing = await readExistingApproval(sql, account, payload);
    const plan = buildPlan(payload, evidence, existing);

    if (!args.write || plan.result !== "planned_insert") {
      print({
        operation: "record_approved_target_policy_v1",
        mode: args.write ? "write" : "dry-run",
        result: plan.result,
        account: payload.account,
        policyVersion: payload.policyVersion,
        vectorRowCount: payload.vector.length,
        databaseTarget: args.target,
        targetFingerprint: target.targetFingerprint,
        blockers: plan.blockers,
      });
      if (plan.result === "blocked") process.exitCode = 1;
      return;
    }

    const query = buildInsertQuery(account, payload);
    const lockName = [
      "varda.target_policy_approval.v1",
      account.ownerUserId,
      account.accountId,
      payload.policyId,
    ].join(":");
    const results = await sql.transaction((transaction) => [
      transaction.query("set local lock_timeout = '2s'"),
      transaction.query("set local statement_timeout = '8s'"),
      transaction.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [lockName],
      ),
      transaction.query(query.text, query.params),
    ]);
    const writeResult = results[3]?.[0];
    const expectedRows = payload.vector.length;
    const recorded =
      Number(writeResult?.revision_count) === 1 &&
      Number(writeResult?.vector_count) === expectedRows &&
      Number(writeResult?.event_count) === 1;

    print({
      operation: "record_approved_target_policy_v1",
      mode: "write",
      result: recorded ? "recorded" : "blocked",
      account: payload.account,
      policyVersion: payload.policyVersion,
      vectorRowCount: expectedRows,
      databaseTarget: args.target,
      targetFingerprint: target.targetFingerprint,
      blockers: recorded ? [] : ["atomic_insert_invariant_failed"],
    });
    if (!recorded) process.exitCode = 1;
  } catch (error) {
    print({
      operation: "record_approved_target_policy_v1",
      mode: process.argv.includes("--write") ? "write" : "dry-run",
      result: "blocked",
      blockers: [safeErrorCode(error)],
    });
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  let file = null;
  let ownerUserId = null;
  let target = "production";
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--write") {
      write = true;
    } else if (value === "--file") {
      file = argv[++index] ?? null;
    } else if (value === "--owner-user-id") {
      ownerUserId = argv[++index]?.trim().toLowerCase() ?? null;
    } else if (value === "--target") {
      target = argv[++index]?.trim().toLowerCase() ?? "";
    } else {
      throw new Error("invalid_arguments");
    }
  }
  if (!file) throw new Error("approval_file_required");
  if (!ownerUserId) throw new Error("owner_user_id_required");
  if (!UUID_PATTERN.test(ownerUserId)) {
    throw new Error("invalid_owner_user_id");
  }
  if (!new Set(["production", "preview"]).has(target)) {
    throw new Error("invalid_database_target");
  }
  return Object.freeze({ file, ownerUserId, target, write });
}

function guardDatabaseTarget(target, env) {
  return target === "preview"
    ? guardPreviewDatabaseTarget(env)
    : guardProductionDatabaseTarget(env);
}

function validatePayload(value) {
  assertPlainObject(value, "invalid_approval_payload");
  assertNoSensitiveKeys(value);
  assertExactKeys(value, [
    "policyId",
    "account",
    "policyVersion",
    "approvalRevision",
    "effectiveServiceDate",
    "universeHash",
    "vectorHash",
    "approvalEvidenceRef",
    "vector",
  ]);
  if (value.policyId !== POLICY_ID) throw new Error("policy_id_mismatch");
  if (!new Set(["brokerage", "isa", "irp"]).has(value.account)) {
    throw new Error("invalid_account");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value.policyVersion)) {
    throw new Error("invalid_policy_version");
  }
  if (!Number.isInteger(value.approvalRevision) || value.approvalRevision < 1) {
    throw new Error("invalid_approval_revision");
  }
  if (!DATE_PATTERN.test(value.effectiveServiceDate)) {
    throw new Error("invalid_effective_service_date");
  }
  if (!SHA256_PATTERN.test(value.universeHash)) {
    throw new Error("invalid_universe_hash");
  }
  if (!SHA256_PATTERN.test(value.vectorHash)) {
    throw new Error("invalid_vector_hash");
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(
      value.approvalEvidenceRef,
    )
  ) {
    throw new Error("invalid_approval_evidence_ref");
  }
  if (!Array.isArray(value.vector) || value.vector.length > 64) {
    throw new Error("invalid_vector_row_count");
  }

  const seen = new Set();
  let totalBps = 0;
  const vector = value.vector.map((row) => {
    assertPlainObject(row, "invalid_vector_row");
    assertExactKeys(row, ["market", "currency", "ticker", "targetWeightBps"]);
    if (
      typeof row.market !== "string" ||
      row.market !== row.market.trim().toLowerCase() ||
      !row.market
    ) {
      throw new Error("invalid_vector_market");
    }
    if (
      typeof row.currency !== "string" ||
      row.currency !== row.currency.trim().toUpperCase() ||
      !row.currency
    ) {
      throw new Error("invalid_vector_currency");
    }
    if (
      typeof row.ticker !== "string" ||
      row.ticker !== row.ticker.trim().toUpperCase() ||
      !row.ticker
    ) {
      throw new Error("invalid_vector_ticker");
    }
    if (
      !Number.isInteger(row.targetWeightBps) ||
      row.targetWeightBps < 0 ||
      row.targetWeightBps > 10_000
    ) {
      throw new Error("invalid_vector_weight");
    }
    const key = `${row.market}:${row.currency}:${row.ticker}`;
    if (seen.has(key)) throw new Error("duplicate_vector_identity");
    seen.add(key);
    totalBps += row.targetWeightBps;
    return Object.freeze({ ...row });
  });
  if (totalBps !== 10_000) throw new Error("invalid_vector_total");

  return Object.freeze({ ...value, vector: Object.freeze(vector) });
}

async function resolveOwnedAccount(sql, payload, ownerUserId) {
  const rows = await sql.query(
    `
      select
        a.id::text as account_id,
        a.canonical_owner_user_id::text as canonical_owner_id
      from accounts a
      join app_users u on u.id = a.canonical_owner_user_id
      where a.code = $1
        and a.is_active = true
        and u.status = 'active'
        and a.canonical_owner_user_id = $2::uuid
      order by a.id
      limit 2
    `,
    [payload.account, ownerUserId],
  );
  if (rows.length !== 1) throw new Error("owned_account_not_unique");
  return Object.freeze({
    accountId: rows[0].account_id,
    ownerUserId: rows[0].canonical_owner_id,
  });
}

async function readAndValidateEvidence(sql, account, payload) {
  const holdings = await sql.query(
    `
      select a.name, a.market, a.currency, a.ticker
      from assets a
      join accounts ac on ac.id = a.account_id
      where ac.id = $1::uuid
        and ac.canonical_owner_user_id = $2::uuid
        and ac.is_active = true
        and a.account = ac.code
        and (a.quantity > 0 or coalesce(a.fractional_krw_value, 0) > 0)
      order by a.market, a.currency, a.ticker, a.name
    `,
    [account.accountId, account.ownerUserId],
  );
  const universe = buildTargetPolicyHoldingUniverse({
    account: payload.account,
    holdings,
  });
  const packet = buildTargetPolicyReviewPacket({
    account: payload.account,
    policyVersion: payload.policyVersion,
    effectiveServiceDate: payload.effectiveServiceDate,
    currentHoldings: universe.rows,
    decisions: payload.vector.map((row) => ({
      ...row,
      decision: row.targetWeightBps === 0 ? "zero_target" : "positive_target",
      exclusionReason: null,
    })),
  });
  const ready =
    universe.status === "reviewable" &&
    packet.status === "reviewable" &&
    universe.universeHash === payload.universeHash &&
    packet.vectorHash === payload.vectorHash;
  if (!ready) throw new Error("approval_evidence_drift");
  return Object.freeze({ status: "matched" });
}

async function readExistingApproval(sql, account, payload) {
  const revisions = await sql.query(
    `
      select
        id::text,
        policy_version,
        approval_revision,
        effective_service_date::text,
        universe_hash,
        vector_hash,
        approval_evidence_ref,
        lifecycle_status
      from target_policy_approval_revisions
      where owner_user_id = $1::uuid
        and account_id = $2::uuid
        and policy_id = $3
      order by approval_revision
      limit 2
    `,
    [account.ownerUserId, account.accountId, payload.policyId],
  );
  if (revisions.length === 0) return Object.freeze({ status: "empty" });
  if (revisions.length !== 1) return Object.freeze({ status: "conflict" });

  const revision = revisions[0];
  const vector = await sql.query(
    `
      select market, currency, ticker, target_weight_bps
      from target_policy_approval_vector_rows
      where approval_revision_id = $1::uuid
      order by market, currency, ticker
      limit 65
    `,
    [revision.id],
  );
  const exact =
    revision.policy_version === payload.policyVersion &&
    Number(revision.approval_revision) === payload.approvalRevision &&
    revision.effective_service_date === payload.effectiveServiceDate &&
    revision.universe_hash === payload.universeHash &&
    revision.vector_hash === payload.vectorHash &&
    revision.approval_evidence_ref === payload.approvalEvidenceRef &&
    revision.lifecycle_status === "approved" &&
    JSON.stringify(normalizeDatabaseVector(vector)) ===
      JSON.stringify(payload.vector);
  return Object.freeze({ status: exact ? "exact" : "conflict" });
}

function buildPlan(payload, evidence, existing) {
  if (evidence.status !== "matched") {
    return Object.freeze({ result: "blocked", blockers: ["evidence_unmatched"] });
  }
  if (existing.status === "exact") {
    return Object.freeze({ result: "already_recorded", blockers: [] });
  }
  if (existing.status !== "empty") {
    return Object.freeze({ result: "blocked", blockers: ["existing_revision_conflict"] });
  }
  return Object.freeze({
    result: "planned_insert",
    blockers: [],
    vectorRowCount: payload.vector.length,
  });
}

function buildInsertQuery(account, payload) {
  const params = [
    account.ownerUserId,
    account.accountId,
    payload.policyId,
    payload.policyVersion,
    payload.approvalRevision,
    payload.effectiveServiceDate,
    payload.universeHash,
    payload.vectorHash,
    payload.approvalEvidenceRef,
  ];
  const values = payload.vector.map((row) => {
    const start = params.length + 1;
    params.push(row.market, row.currency, row.ticker, row.targetWeightBps);
    return `($${start}::varchar, $${start + 1}::varchar, $${start + 2}::varchar, $${start + 3}::integer)`;
  });

  return Object.freeze({
    text: `
      with inserted_revision as (
        insert into target_policy_approval_revisions (
          owner_user_id, account_id, policy_id, policy_version,
          approval_revision, effective_service_date, universe_hash,
          vector_hash, approval_evidence_ref, approved_at,
          lifecycle_status, terminal_at
        )
        select
          $1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::integer,
          $6::date, $7::varchar, $8::varchar, $9::varchar,
          transaction_timestamp(), 'approved', null
        where not exists (
          select 1
          from target_policy_approval_revisions
          where owner_user_id = $1::uuid
            and account_id = $2::uuid
            and policy_id = $3::varchar
        )
        returning id
      ), input_rows (market, currency, ticker, target_weight_bps) as (
        values ${values.join(",\n          ")}
      ), inserted_vector as (
        insert into target_policy_approval_vector_rows (
          approval_revision_id, market, currency, ticker, target_weight_bps
        )
        select r.id, v.market, v.currency, v.ticker, v.target_weight_bps
        from inserted_revision r
        cross join input_rows v
        returning 1
      ), inserted_event as (
        insert into target_policy_approval_lifecycle_events (
          approval_revision_id, event_sequence, audit_version,
          transition_kind, previous_status, resulting_status,
          transitioned_at, replacement_revision_id
        )
        select
          id, 1, '${AUDIT_VERSION}', 'explicit_approval', null, 'approved',
          transaction_timestamp(), null
        from inserted_revision
        returning 1
      )
      select
        (select count(*)::int from inserted_revision) as revision_count,
        (select count(*)::int from inserted_vector) as vector_count,
        (select count(*)::int from inserted_event) as event_count
    `,
    params: Object.freeze(params),
  });
}

function normalizeDatabaseVector(rows) {
  return rows.map((row) => ({
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    targetWeightBps: Number(row.target_weight_bps),
  }));
}

function assertPlainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
}

function assertExactKeys(value, allowed) {
  const allowedSet = new Set(allowed);
  if (
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((key) => !allowedSet.has(key))
  ) {
    throw new Error("unexpected_approval_field");
  }
}

function assertNoSensitiveKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveKeys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) throw new Error("sensitive_field_blocked");
    assertNoSensitiveKeys(nested);
  }
}

function safeErrorCode(error) {
  const databaseCode =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code.toUpperCase()
      : "";
  if (new Set(["55P03", "57014"]).has(databaseCode)) {
    return "database_timeout";
  }
  if (databaseCode.startsWith("23")) {
    return "database_constraint_violation";
  }
  if (databaseCode === "42P08" && error instanceof Error) {
    const parameter = error.message.match(/parameter \$(\d+)/i)?.[1];
    if (parameter) return `database_42p08_parameter_${parameter}`;
  }
  if (/^[0-9A-Z]{5}$/.test(databaseCode)) {
    return `database_${databaseCode.toLowerCase()}`;
  }
  const message = error instanceof Error ? error.message : "unexpected_failure";
  return /^[a-z0-9_]+$/.test(message) ? message : "operation_failed";
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}
