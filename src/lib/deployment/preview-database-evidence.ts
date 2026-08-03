import {
  PREVIEW_DATABASE_TARGET_GUARD_POLICY,
  guardPreviewDatabaseTarget,
  sha256Fingerprint,
  type PreviewDatabaseTargetGuardEnvironment,
} from "./preview-database-target.ts";
import type { AppliedMigrationEvidence } from "./preview-migration-plan.ts";

const REVIEWED_COLUMNS = Object.freeze([
  "adjusted_close_basis",
  "adjusted_close_provider",
  "adjusted_close_source",
  "adjusted_close_fetched_at",
  "provider_symbol",
  "provider_exchange",
  "fetched_at",
]);
const REVIEWED_INDEXES = Object.freeze({
  instrumentDate: Object.freeze({
    name: "asset_price_snapshots_instrument_date_unique",
    columns: Object.freeze(["market", "currency", "ticker", "date"]),
    unique: true,
    hasPredicate: false,
  }),
  legacyTickerDate: Object.freeze({
    name: "asset_price_snapshots_ticker_date_unique",
    columns: Object.freeze(["ticker", "date"]),
    unique: true,
    hasPredicate: false,
  }),
  accountOwner: Object.freeze({
    name: "accounts_id_canonical_owner_unique",
    columns: Object.freeze(["id", "canonical_owner_user_id"]),
    unique: true,
    hasPredicate: false,
  }),
  targetPolicyIdentityRevision: Object.freeze({
    name: "target_policy_revisions_identity_revision_unique",
    columns: Object.freeze([
      "owner_user_id",
      "account_id",
      "policy_id",
      "policy_version",
      "approval_revision",
    ]),
    unique: true,
    hasPredicate: false,
  }),
  targetPolicyCurrent: Object.freeze({
    name: "target_policy_revisions_current_unique",
    columns: Object.freeze(["owner_user_id", "account_id", "policy_id"]),
    unique: true,
    hasPredicate: true,
  }),
  targetPolicyEventSequence: Object.freeze({
    name: "target_policy_events_revision_sequence_unique",
    columns: Object.freeze(["approval_revision_id", "event_sequence"]),
    unique: true,
    hasPredicate: false,
  }),
});
const TARGET_POLICY_TABLES = Object.freeze([
  "target_policy_approval_revisions",
  "target_policy_approval_vector_rows",
  "target_policy_approval_lifecycle_events",
]);
const TARGET_POLICY_CONSTRAINTS = Object.freeze([
  "target_policy_events_sequence_check",
  "target_policy_events_audit_version_check",
  "target_policy_events_transition_shape_check",
  "target_policy_events_revision_fk",
  "target_policy_events_replacement_fk",
  "target_policy_revisions_policy_id_check",
  "target_policy_revisions_version_check",
  "target_policy_revisions_revision_check",
  "target_policy_revisions_universe_hash_check",
  "target_policy_revisions_vector_hash_check",
  "target_policy_revisions_evidence_ref_check",
  "target_policy_revisions_status_check",
  "target_policy_revisions_terminal_state_check",
  "target_policy_revisions_owner_user_fk",
  "target_policy_revisions_account_owner_fk",
  "target_policy_vector_rows_pk",
  "target_policy_vector_rows_market_check",
  "target_policy_vector_rows_currency_check",
  "target_policy_vector_rows_ticker_check",
  "target_policy_vector_rows_weight_check",
  "target_policy_vector_rows_revision_fk",
]);

type Query = (query: string) => Promise<Record<string, unknown>[]>;

export type PreviewDatabaseState = {
  target: ReturnType<typeof guardPreviewDatabaseTarget>;
  rowCounts: {
    assets: number;
    priceSnapshots: number;
    fxRates: number;
    approvalRevisions: number;
  };
  latestMigration: {
    createdAt: number;
    sha256: string;
  } | null;
  appliedMigrations: AppliedMigrationEvidence[];
  reviewedCatalog: {
    adjustedClosePriceNullable: boolean;
    presentColumns: string[];
    instrumentDateUniqueIndexExact: boolean;
    legacyTickerDateUniqueIndexExact: boolean;
    legacyTickerDateIndexPresent: boolean;
    targetPolicyTables: string[];
    targetPolicyConstraints: string[];
    targetPolicyRows: TargetPolicyRowCounts | null;
    accountOwnerUniqueIndexExact: boolean;
    targetPolicyIdentityRevisionIndexExact: boolean;
    targetPolicyCurrentIndexExact: boolean;
    targetPolicyEventSequenceIndexExact: boolean;
  };
};

export type TargetPolicyRowCounts = {
  revisions: number;
  vectorRows: number;
  lifecycleEvents: number;
};

export async function readPreviewDatabaseState(input: {
  env: PreviewDatabaseTargetGuardEnvironment;
  query: Query;
}): Promise<PreviewDatabaseState> {
  const target = guardPreviewDatabaseTarget(input.env);
  const [
    countRows,
    migrationRows,
    columnRows,
    indexRows,
    targetPolicyTableRows,
    targetPolicyConstraintRows,
  ] = await Promise.all([
    input.query(`
      select
        (select count(*)::integer from assets) as assets,
        (select count(*)::integer from asset_price_snapshots) as price_snapshots,
        (select count(*)::integer from fx_rates) as fx_rates,
        (
          select count(*)::integer
            from simulation_scenario_approval_revisions
        ) as approval_revisions
    `),
    input.query(`
      select hash, created_at::text as created_at
        from drizzle.__drizzle_migrations
       order by created_at asc
    `),
    input.query(`
      select column_name, is_nullable
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'asset_price_snapshots'
         and column_name in (
           'adjusted_close_price',
           'adjusted_close_basis',
           'adjusted_close_provider',
           'adjusted_close_source',
           'adjusted_close_fetched_at',
           'provider_symbol',
           'provider_exchange',
           'fetched_at'
         )
       order by column_name
    `),
    input.query(`
      select
        index_class.relname as index_name,
        index_definition.indisvalid as is_valid,
        index_definition.indisunique as is_unique,
        index_definition.indisready as is_ready,
        index_definition.indislive as is_live,
        (index_definition.indpred is null) as has_no_predicate,
        (index_definition.indexprs is null) as has_no_expressions,
        index_definition.indnkeyatts::integer as key_attribute_count,
        index_definition.indnatts::integer as total_attribute_count,
        string_agg(
          table_attribute.attname,
          ','
          order by index_key.ordinality
        ) as key_columns
      from pg_catalog.pg_index as index_definition
      join pg_catalog.pg_class as index_class
        on index_class.oid = index_definition.indexrelid
      join pg_catalog.pg_class as table_class
        on table_class.oid = index_definition.indrelid
      join pg_catalog.pg_namespace as table_namespace
        on table_namespace.oid = table_class.relnamespace
      cross join lateral unnest(index_definition.indkey)
        with ordinality as index_key(attribute_number, ordinality)
      left join pg_catalog.pg_attribute as table_attribute
        on table_attribute.attrelid = table_class.oid
       and table_attribute.attnum = index_key.attribute_number
      where table_namespace.nspname = 'public'
        and table_class.relname in (
          'asset_price_snapshots',
          'accounts',
          'target_policy_approval_revisions',
          'target_policy_approval_lifecycle_events'
        )
        and index_class.relname in (
          'asset_price_snapshots_instrument_date_unique',
          'asset_price_snapshots_ticker_date_unique',
          'accounts_id_canonical_owner_unique',
          'target_policy_revisions_identity_revision_unique',
          'target_policy_revisions_current_unique',
          'target_policy_events_revision_sequence_unique'
        )
      group by
        index_class.relname,
        index_definition.indisvalid,
        index_definition.indisunique,
        index_definition.indisready,
        index_definition.indislive,
        (index_definition.indpred is null),
        (index_definition.indexprs is null),
        index_definition.indnkeyatts,
        index_definition.indnatts
      order by index_class.relname
    `),
    input.query(`
      select table_name
        from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'target_policy_approval_revisions',
           'target_policy_approval_vector_rows',
           'target_policy_approval_lifecycle_events'
         )
       order by table_name
    `),
    input.query(`
      select constraint_definition.conname as constraint_name,
             constraint_definition.convalidated as is_validated
        from pg_catalog.pg_constraint as constraint_definition
        join pg_catalog.pg_class as table_class
          on table_class.oid = constraint_definition.conrelid
        join pg_catalog.pg_namespace as table_namespace
          on table_namespace.oid = table_class.relnamespace
       where table_namespace.nspname = 'public'
         and table_class.relname in (
           'target_policy_approval_revisions',
           'target_policy_approval_vector_rows',
           'target_policy_approval_lifecycle_events'
         )
       order by constraint_definition.conname
    `),
  ]);

  if (countRows.length !== 1) {
    throw new Error("Preview database row-count evidence is unavailable.");
  }

  const counts = countRows[0];
  const adjustedClosePrice = columnRows.find(
    ({ column_name }) => column_name === "adjusted_close_price",
  );
  const presentColumns = REVIEWED_COLUMNS.filter((columnName) =>
    columnRows.some(({ column_name }) => column_name === columnName),
  );
  const presentTargetPolicyTables = TARGET_POLICY_TABLES.filter((tableName) =>
    targetPolicyTableRows.some(({ table_name }) => table_name === tableName),
  );
  const presentTargetPolicyConstraints = TARGET_POLICY_CONSTRAINTS.filter(
    (constraintName) =>
      targetPolicyConstraintRows.some(
        ({ constraint_name, is_validated }) =>
          constraint_name === constraintName && is_validated === true,
      ),
  );
  const targetPolicyRows =
    presentTargetPolicyTables.length === TARGET_POLICY_TABLES.length
      ? await readTargetPolicyRowCounts(input.query)
      : null;

  const appliedMigrations = migrationRows.map((row) => ({
    createdAt: integerValue(
      row.created_at,
      "applied migration timestamp",
    ),
    sha256: String(row.hash ?? ""),
  }));
  const latestMigration =
    appliedMigrations[appliedMigrations.length - 1] ?? null;

  return {
    target,
    rowCounts: {
      assets: integerValue(counts.assets, "assets"),
      priceSnapshots: integerValue(
        counts.price_snapshots,
        "asset price snapshots",
      ),
      fxRates: integerValue(counts.fx_rates, "FX rates"),
      approvalRevisions: integerValue(
        counts.approval_revisions,
        "approval revisions",
      ),
    },
    latestMigration,
    appliedMigrations,
    reviewedCatalog: {
      adjustedClosePriceNullable:
        adjustedClosePrice?.is_nullable === "YES",
      presentColumns,
      instrumentDateUniqueIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.instrumentDate,
      ),
      legacyTickerDateUniqueIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.legacyTickerDate,
      ),
      legacyTickerDateIndexPresent: hasNamedIndex(
        indexRows,
        REVIEWED_INDEXES.legacyTickerDate.name,
      ),
      targetPolicyTables: presentTargetPolicyTables,
      targetPolicyConstraints: presentTargetPolicyConstraints,
      targetPolicyRows,
      accountOwnerUniqueIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.accountOwner,
      ),
      targetPolicyIdentityRevisionIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.targetPolicyIdentityRevision,
      ),
      targetPolicyCurrentIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.targetPolicyCurrent,
      ),
      targetPolicyEventSequenceIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.targetPolicyEventSequence,
      ),
    },
  };
}

export function assertReviewedPreviewDatabaseState(
  state: PreviewDatabaseState,
) {
  if (!hasReviewedMigrationLedger(state)) {
    throw new Error(
      "Preview database migration ledger does not match the reviewed 0022 ledger.",
    );
  }
  if (!hasReviewedLatestMigration(state)) {
    throw new Error(
      `Preview database latest migration is not ${PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration.tag}.`,
    );
  }
  assertReviewedPreviewDatabaseCatalog(state);
}

export function assertReviewedPreviewDatabaseCatalog(
  state: PreviewDatabaseState,
) {
  if (!hasReviewedCatalog(state)) {
    throw new Error(
      "Preview database reviewed 0022 catalog is incomplete.",
    );
  }
}

export function assertReviewedPreTargetPolicyPreviewDatabaseCatalog(
  state: PreviewDatabaseState,
) {
  if (!hasReviewedAssetPriceCatalog(state)) {
    throw new Error(
      "Preview database reviewed 0021 prerequisite catalog is incomplete.",
    );
  }
}

export function assertPreviewTargetPolicyRowsPreserved(
  before: TargetPolicyRowCounts | null,
  after: TargetPolicyRowCounts | null,
) {
  if (after === null) {
    throw new Error(
      "Preview postflight target-policy row evidence is unavailable.",
    );
  }

  const expected = before ?? {
    revisions: 0,
    vectorRows: 0,
    lifecycleEvents: 0,
  };
  if (
    after.revisions !== expected.revisions ||
    after.vectorRows !== expected.vectorRows ||
    after.lifecycleEvents !== expected.lifecycleEvents
  ) {
    throw new Error(
      before === null
        ? "Preview migration unexpectedly seeded target-policy rows."
        : "Preview migration changed inherited target-policy row counts.",
    );
  }
}

export function publicPreviewDatabaseEvidence(state: PreviewDatabaseState) {
  const reviewedMigrationLedgerPresent =
    hasReviewedMigrationLedger(state);
  const reviewedMigrationPresent = hasReviewedLatestMigration(state);
  const reviewedAssetPriceCatalogPresent =
    hasReviewedAssetPriceCatalog(state);
  const reviewedTargetPolicyCatalogPresent =
    hasReviewedTargetPolicyCatalog(state);
  return {
    evidenceVersion: "preview_database_evidence_v5",
    status: "operational_guard_passed",
    targetFingerprint: state.target.targetFingerprint,
    endpointProjectBinding: state.target.endpointProjectBinding,
    rowCounts: state.rowCounts,
    latestReviewedMigration: reviewedMigrationPresent
      ? PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration.tag
      : null,
    migrationLedgerStatus: reviewedMigrationLedgerPresent
      ? "reviewed_0022_present"
      : "reviewed_0022_not_present",
    assetPriceCatalogStatus: reviewedAssetPriceCatalogPresent
      ? "reviewed_0020_present"
      : "reviewed_0020_not_present",
    targetPolicyCatalogStatus: reviewedTargetPolicyCatalogPresent
      ? "reviewed_0022_present"
      : "reviewed_0022_not_present",
  };
}

function hasReviewedMigrationLedger(state: PreviewDatabaseState) {
  const reviewed =
    PREVIEW_DATABASE_TARGET_GUARD_POLICY.reviewedMigrationLedger;
  return (
    state.appliedMigrations.length === reviewed.entryCount &&
    sha256Fingerprint(
      JSON.stringify(
        state.appliedMigrations.map(({ createdAt, sha256 }) => ({
          createdAt,
          sha256,
        })),
      ),
    ) === reviewed.sha256
  );
}

function hasReviewedLatestMigration(state: PreviewDatabaseState) {
  const reviewed = PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration;
  return (
    state.latestMigration?.createdAt === reviewed.createdAt &&
    state.latestMigration.sha256 === reviewed.sha256
  );
}

function hasReviewedCatalog(state: PreviewDatabaseState) {
  return (
    hasReviewedAssetPriceCatalog(state) &&
    hasReviewedTargetPolicyCatalog(state)
  );
}

function hasReviewedAssetPriceCatalog(state: PreviewDatabaseState) {
  return (
    state.reviewedCatalog.adjustedClosePriceNullable &&
    state.reviewedCatalog.presentColumns.length === REVIEWED_COLUMNS.length &&
    state.reviewedCatalog.instrumentDateUniqueIndexExact &&
    !state.reviewedCatalog.legacyTickerDateIndexPresent
  );
}

function hasReviewedTargetPolicyCatalog(state: PreviewDatabaseState) {
  return (
    state.reviewedCatalog.targetPolicyTables.length ===
      TARGET_POLICY_TABLES.length &&
    state.reviewedCatalog.targetPolicyConstraints.length ===
      TARGET_POLICY_CONSTRAINTS.length &&
    state.reviewedCatalog.targetPolicyRows !== null &&
    state.reviewedCatalog.accountOwnerUniqueIndexExact &&
    state.reviewedCatalog.targetPolicyIdentityRevisionIndexExact &&
    state.reviewedCatalog.targetPolicyCurrentIndexExact &&
    state.reviewedCatalog.targetPolicyEventSequenceIndexExact
  );
}

function hasNamedIndex(rows: Record<string, unknown>[], name: string) {
  return rows.some(({ index_name }) => index_name === name);
}

function hasExactUniqueIndex(
  rows: Record<string, unknown>[],
  expected: {
    name: string;
    columns: readonly string[];
    unique: boolean;
    hasPredicate: boolean;
  },
) {
  const matching = rows.filter(({ index_name }) => index_name === expected.name);
  if (matching.length !== 1) return false;

  const row = matching[0];
  return (
    row.is_valid === true &&
    row.is_unique === expected.unique &&
    row.is_ready === true &&
    row.is_live === true &&
    row.has_no_predicate === !expected.hasPredicate &&
    row.has_no_expressions === true &&
    Number(row.key_attribute_count) === expected.columns.length &&
    Number(row.total_attribute_count) === expected.columns.length &&
    row.key_columns === expected.columns.join(",")
  );
}

async function readTargetPolicyRowCounts(query: Query) {
  const rows = await query(`
    select
      (
        select count(*)::integer
          from target_policy_approval_revisions
      ) as revisions,
      (
        select count(*)::integer
          from target_policy_approval_vector_rows
      ) as vector_rows,
      (
        select count(*)::integer
          from target_policy_approval_lifecycle_events
      ) as lifecycle_events
  `);
  if (rows.length !== 1) {
    throw new Error("Preview database target-policy row evidence is unavailable.");
  }
  return {
    revisions: integerValue(rows[0].revisions, "target policy revisions"),
    vectorRows: integerValue(rows[0].vector_rows, "target policy vector rows"),
    lifecycleEvents: integerValue(
      rows[0].lifecycle_events,
      "target policy lifecycle events",
    ),
  };
}

function integerValue(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Preview database ${label} evidence is invalid.`);
  }
  return parsed;
}
