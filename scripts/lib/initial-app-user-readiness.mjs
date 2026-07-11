import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { TENANT_WRITER_REGISTRY } from "../../src/lib/tenant-writer-registry.ts";
import { USER_OWNED_TABLE_NAMES } from "./tenant-ownership-policy.mjs";

const EXPECTED_IDENTITY_COLUMNS = Object.freeze({
  "app_users.id": column("uuid", "NO", null, "gen_random_uuid"),
  "app_users.status": column("varchar", "NO", 20, "provisioning"),
  "app_users.role": column("varchar", "NO", 20, "user"),
  "app_users.created_at": column("timestamptz", "NO", null, "now()"),
  "app_users.updated_at": column("timestamptz", "NO", null, "now()"),
  "auth_identities.id": column("uuid", "NO", null, "gen_random_uuid"),
  "auth_identities.app_user_id": column("uuid", "NO", null, null),
  "auth_identities.provider": column("varchar", "NO", 50, null),
  "auth_identities.provider_subject": column("varchar", "NO", 255, null),
  "auth_identities.status": column("varchar", "NO", 20, "active"),
  "auth_identities.disabled_at": column("timestamptz", "YES", null, null),
  "auth_identities.created_at": column("timestamptz", "NO", null, "now()"),
  "auth_identities.updated_at": column("timestamptz", "NO", null, "now()"),
});

const EXPECTED_IDENTITY_CONSTRAINTS = Object.freeze([
  "app_users_pkey",
  "app_users_role_check",
  "app_users_status_check",
  "auth_identities_app_user_id_app_users_id_fk",
  "auth_identities_disabled_state_check",
  "auth_identities_pkey",
  "auth_identities_provider_check",
  "auth_identities_provider_subject_check",
  "auth_identities_status_check",
]);

const EXPECTED_IDENTITY_INDEXES = Object.freeze([
  "app_users_pkey",
  "auth_identities_active_app_user_provider_unique",
  "auth_identities_app_user_id_idx",
  "auth_identities_pkey",
  "auth_identities_provider_subject_unique",
]);

export function evaluateSchemaManifest({
  identityColumns,
  identityConstraints,
  identityIndexes,
  canonicalColumns,
  canonicalIndexes,
}) {
  const identityColumnContract =
    identityColumns.length === Object.keys(EXPECTED_IDENTITY_COLUMNS).length &&
    identityColumns.every((row) => {
      const expected =
        EXPECTED_IDENTITY_COLUMNS[`${row.table_name}.${row.column_name}`];
      return expected !== undefined && matchesColumn(row, expected);
    });

  const constraintNames = identityConstraints.map(({ conname }) => conname);
  const identityConstraintContract =
    sameStrings(constraintNames, EXPECTED_IDENTITY_CONSTRAINTS) &&
    identityConstraints.every(matchesConstraint);

  const indexNames = identityIndexes.map(({ indexname }) => indexname);
  const identityIndexContract =
    sameStrings(indexNames, EXPECTED_IDENTITY_INDEXES) &&
    identityIndexes.every(matchesIdentityIndex);

  const expectedOwnerTables = [...USER_OWNED_TABLE_NAMES].sort();
  const canonicalColumnContract =
    canonicalColumns.length === expectedOwnerTables.length &&
    sameStrings(
      canonicalColumns.map(({ table_name }) => table_name),
      expectedOwnerTables,
    ) &&
    canonicalColumns.every(
      ({ data_type, is_nullable, column_default }) =>
        data_type === "uuid" &&
        is_nullable === "YES" &&
        column_default === null,
    );

  const canonicalIndexContract =
    canonicalIndexes.length === expectedOwnerTables.length &&
    sameStrings(
      canonicalIndexes.map(({ indexname }) => indexname),
      expectedOwnerTables.map(
        (table) => `${table}_canonical_owner_user_id_idx`,
      ),
    ) &&
    canonicalIndexes.every(({ tablename, indexdef }) => {
      const normalized = normalizeSql(indexdef);
      return (
        expectedOwnerTables.includes(tablename) &&
        normalized.includes("(canonical_owner_user_id)")
      );
    });

  return {
    identityColumnContract,
    identityConstraintContract,
    identityIndexContract,
    canonicalColumnContract,
    canonicalIndexContract,
  };
}

export function readWriterReadiness(root = process.cwd()) {
  const implementationPaths = [
    ...new Set(
      TENANT_WRITER_REGISTRY.flatMap(
        ({ implementationPaths: paths }) => paths,
      ),
    ),
  ];
  const implementationSources = implementationPaths.map((path) =>
    readFileSync(join(root, path), "utf8"),
  );
  const runtimeOwnerIntegrationCount = implementationSources.filter((source) =>
    source.includes("tenant-write-context"),
  ).length;

  const apiSources = walkFiles(join(root, "src", "app", "api")).map((path) =>
    readFileSync(path, "utf8"),
  );
  const httpCanonicalOwnerInputCount = apiSources.filter((source) =>
    /canonicalOwnerUserId|canonical_owner_user_id/.test(source),
  ).length;

  const ownerInferencePattern =
    /(?:legacy|created_by|createdBy|owner_user_id|ownerUserId)[^\n]{0,120}(?:canonical_owner_user_id|canonicalOwnerUserId)|(?:canonical_owner_user_id|canonicalOwnerUserId)[^\n]{0,120}(?:legacy|created_by|createdBy|owner_user_id|ownerUserId)/i;
  const ownerInferencePathCount = implementationSources.filter((source) =>
    ownerInferencePattern.test(source),
  ).length;

  const userWriterPrepareContract = TENANT_WRITER_REGISTRY.filter((writer) =>
    writer.targets.some(({ classification }) => classification === "user_owned"),
  ).every(({ transition }) =>
    ["shadow_trusted_context", "split_target_classes"].includes(
      transition.prepare,
    ),
  );

  return {
    registryShadow:
      TENANT_WRITER_REGISTRY.every(
        ({ canonicalOwnerHttpInput }) =>
          canonicalOwnerHttpInput === "forbidden",
      ) &&
      userWriterPrepareContract &&
      runtimeOwnerIntegrationCount === 0,
    runtimeOwnerIntegrationCount,
    httpCanonicalOwnerInputCount,
    ownerInferencePathCount,
  };
}

function column(udtName, nullable, length, defaultToken) {
  return Object.freeze({ udtName, nullable, length, defaultToken });
}

function matchesColumn(row, expected) {
  const defaultValue = row.column_default ?? null;
  return (
    row.udt_name === expected.udtName &&
    row.is_nullable === expected.nullable &&
    normalizeNumber(row.character_maximum_length) === expected.length &&
    (expected.defaultToken === null
      ? defaultValue === null
      : typeof defaultValue === "string" &&
        defaultValue.includes(expected.defaultToken))
  );
}

function matchesConstraint({ conname, contype, confdeltype, definition }) {
  const sql = normalizeSql(definition);
  const checks = {
    app_users_pkey:
      contype === "p" && sql.includes("primary key (id)"),
    app_users_role_check:
      contype === "c" && includesAll(sql, ["role", "user", "admin"]),
    app_users_status_check:
      contype === "c" &&
      includesAll(sql, ["status", "provisioning", "active", "disabled"]),
    auth_identities_app_user_id_app_users_id_fk:
      contype === "f" &&
      confdeltype === "r" &&
      includesAll(sql, [
        "foreign key (app_user_id)",
        "references app_users(id)",
        "on delete restrict",
      ]),
    auth_identities_disabled_state_check:
      contype === "c" &&
      includesAll(sql, ["status", "active", "disabled", "disabled_at"]),
    auth_identities_pkey:
      contype === "p" && sql.includes("primary key (id)"),
    auth_identities_provider_check:
      contype === "c" &&
      includesAll(sql, ["provider", "lower", "btrim", "char_length"]),
    auth_identities_provider_subject_check:
      contype === "c" &&
      includesAll(sql, ["provider_subject", "btrim", "char_length"]) &&
      !sql.includes("lower(btrim(provider_subject"),
    auth_identities_status_check:
      contype === "c" && includesAll(sql, ["status", "active", "disabled"]),
  };

  return checks[conname] === true;
}

function matchesIdentityIndex({ indexname, indexdef }) {
  const sql = normalizeSql(indexdef);
  const checks = {
    app_users_pkey:
      sql.includes("unique index") &&
      sql.includes("app_users") &&
      sql.includes("(id)"),
    auth_identities_active_app_user_provider_unique:
      sql.includes("unique index") &&
      sql.includes("(app_user_id, provider)") &&
      includesAll(sql, ["where", "status", "active"]),
    auth_identities_app_user_id_idx:
      !sql.includes("unique index") && sql.includes("(app_user_id)"),
    auth_identities_pkey:
      sql.includes("unique index") &&
      sql.includes("auth_identities") &&
      sql.includes("(id)"),
    auth_identities_provider_subject_unique:
      sql.includes("unique index") &&
      sql.includes("(provider, provider_subject)"),
  };

  return checks[indexname] === true;
}

function sameStrings(actual, expected) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  return (
    actualSorted.length === expectedSorted.length &&
    actualSorted.every((value, index) => value === expectedSorted[index])
  );
}

function includesAll(value, tokens) {
  return tokens.every((token) => value.includes(token));
}

function normalizeSql(value) {
  return String(value)
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walkFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".mjs")) {
      files.push(path);
    }
  }
  return files;
}
