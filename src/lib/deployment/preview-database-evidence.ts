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
  accountOwnerCode: Object.freeze({
    name: "accounts_canonical_owner_code_unique",
    columns: Object.freeze(["canonical_owner_user_id", "code"]),
    unique: true,
    hasPredicate: true,
  }),
  assetAccount: Object.freeze({
    name: "assets_id_account_unique",
    columns: Object.freeze(["id", "account_id"]),
    unique: true,
    hasPredicate: false,
  }),
  assetCanonicalOwner: Object.freeze({
    name: "assets_id_canonical_owner_unique",
    columns: Object.freeze(["id", "canonical_owner_user_id"]),
    unique: true,
    hasPredicate: false,
  }),
  portfolioGroupOwner: Object.freeze({
    name: "portfolio_groups_id_canonical_owner_unique",
    columns: Object.freeze(["id", "canonical_owner_user_id"]),
    unique: true,
    hasPredicate: false,
  }),
  portfolioGroupAccountStart: Object.freeze({
    name: "portfolio_group_account_memberships_start_unique",
    columns: Object.freeze(["portfolio_group_id", "account_id", "valid_from"]),
    unique: true,
    hasPredicate: false,
  }),
  portfolioGroupAccountActive: Object.freeze({
    name: "portfolio_group_account_memberships_active_unique",
    columns: Object.freeze(["portfolio_group_id", "account_id"]),
    unique: true,
    hasPredicate: true,
  }),
  portfolioGroupAssetStart: Object.freeze({
    name: "portfolio_group_asset_memberships_start_unique",
    columns: Object.freeze(["portfolio_group_id", "asset_id", "valid_from"]),
    unique: true,
    hasPredicate: false,
  }),
  portfolioGroupAssetActive: Object.freeze({
    name: "portfolio_group_asset_memberships_active_unique",
    columns: Object.freeze(["portfolio_group_id", "asset_id"]),
    unique: true,
    hasPredicate: true,
  }),
  portfolioSnapshotIdentity: Object.freeze({
    name: "daily_portfolio_snapshots_date_account_source_unique",
    columns: Object.freeze([
      "canonical_owner_user_id",
      "snapshot_date",
      "account",
      "source",
    ]),
    unique: true,
    hasPredicate: true,
  }),
  positionSnapshotIdentity: Object.freeze({
    name: "daily_position_snapshots_date_account_asset_source_unique",
    columns: Object.freeze([
      "canonical_owner_user_id",
      "snapshot_date",
      "account",
      "asset_id",
      "source",
    ]),
    unique: true,
    hasPredicate: true,
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
  holdingOnboardingAsset: Object.freeze({
    name: "holding_onboarding_evidence_asset_unique",
    columns: Object.freeze(["asset_id"]),
    unique: true,
    hasPredicate: false,
  }),
  holdingOnboardingOwner: Object.freeze({
    name: "holding_onboarding_evidence_owner_user_id_idx",
    columns: Object.freeze(["canonical_owner_user_id"]),
    unique: false,
    hasPredicate: false,
  }),
  holdingOnboardingAccount: Object.freeze({
    name: "holding_onboarding_evidence_account_id_idx",
    columns: Object.freeze(["account_id"]),
    unique: false,
    hasPredicate: false,
  }),
});
const PORTFOLIO_TARGET_POLICY_INDEXES = Object.freeze([
  Object.freeze({
    name: "portfolio_target_events_revision_sequence_unique",
    columns: Object.freeze(["approval_revision_id", "event_sequence"]),
    unique: true,
    hasPredicate: false,
  }),
  Object.freeze({
    name: "portfolio_target_revisions_id_owner_unique",
    columns: Object.freeze(["id", "canonical_owner_user_id"]),
    unique: true,
    hasPredicate: false,
  }),
  Object.freeze({
    name: "portfolio_target_revisions_all_revision_unique",
    columns: Object.freeze(["canonical_owner_user_id", "approval_revision"]),
    unique: true,
    hasPredicate: true,
  }),
  Object.freeze({
    name: "portfolio_target_revisions_account_revision_unique",
    columns: Object.freeze([
      "canonical_owner_user_id",
      "scope_account_id",
      "approval_revision",
    ]),
    unique: true,
    hasPredicate: true,
  }),
  Object.freeze({
    name: "portfolio_target_revisions_group_revision_unique",
    columns: Object.freeze([
      "canonical_owner_user_id",
      "scope_portfolio_group_id",
      "approval_revision",
    ]),
    unique: true,
    hasPredicate: true,
  }),
  Object.freeze({
    name: "portfolio_target_current_all_unique",
    columns: Object.freeze(["canonical_owner_user_id"]),
    unique: true,
    hasPredicate: true,
  }),
  Object.freeze({
    name: "portfolio_target_current_account_unique",
    columns: Object.freeze(["canonical_owner_user_id", "scope_account_id"]),
    unique: true,
    hasPredicate: true,
  }),
  Object.freeze({
    name: "portfolio_target_current_group_unique",
    columns: Object.freeze([
      "canonical_owner_user_id",
      "scope_portfolio_group_id",
    ]),
    unique: true,
    hasPredicate: true,
  }),
]);
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
const SNAPSHOT_OWNERSHIP_CONSTRAINTS = Object.freeze([
  Object.freeze({
    table: "daily_portfolio_snapshots",
    name: "daily_portfolio_snapshots_owner_user_fk",
    type: "f",
    validated: true,
  }),
  Object.freeze({
    table: "daily_portfolio_snapshots",
    name: "daily_portfolio_snapshots_account_owner_fk",
    type: "f",
    validated: true,
  }),
  Object.freeze({
    table: "daily_portfolio_snapshots",
    name: "daily_portfolio_snapshots_generated_owner_check",
    type: "c",
    validated: null,
  }),
  Object.freeze({
    table: "daily_position_snapshots",
    name: "daily_position_snapshots_owner_user_fk",
    type: "f",
    validated: true,
  }),
  Object.freeze({
    table: "daily_position_snapshots",
    name: "daily_position_snapshots_account_owner_fk",
    type: "f",
    validated: true,
  }),
  Object.freeze({
    table: "daily_position_snapshots",
    name: "daily_position_snapshots_asset_account_fk",
    type: "f",
    validated: true,
  }),
  Object.freeze({
    table: "daily_position_snapshots",
    name: "daily_position_snapshots_generated_owner_check",
    type: "c",
    validated: null,
  }),
  Object.freeze({
    table: "daily_position_snapshots",
    name: "daily_position_snapshots_asset_identity_check",
    type: "c",
    validated: true,
  }),
]);
const PORTFOLIO_SCOPE_TABLES = Object.freeze([
  "portfolio_group_account_memberships",
  "portfolio_group_asset_memberships",
  "portfolio_groups",
]);
const PORTFOLIO_SCOPE_CONSTRAINTS = Object.freeze([
  "portfolio_group_account_memberships_account_owner_fk",
  "portfolio_group_account_memberships_group_owner_fk",
  "portfolio_group_account_memberships_owner_user_fk",
  "portfolio_group_account_memberships_valid_period_check",
  "portfolio_group_asset_memberships_asset_owner_fk",
  "portfolio_group_asset_memberships_group_owner_fk",
  "portfolio_group_asset_memberships_owner_user_fk",
  "portfolio_group_asset_memberships_valid_period_check",
  "portfolio_groups_archived_at_check",
  "portfolio_groups_name_check",
  "portfolio_groups_owner_user_fk",
  "portfolio_groups_sort_order_check",
]);
const HOLDING_ONBOARDING_TABLES = Object.freeze([
  "holding_onboarding_evidence",
]);
const HOLDING_ONBOARDING_COLUMNS = Object.freeze([
  "account_id",
  "asset_id",
  "average_cost",
  "canonical_owner_user_id",
  "created_at",
  "currency",
  "current_price",
  "id",
  "policy_version",
  "price_as_of",
  "price_source",
  "quantity",
  "recorded_at",
  "reported_return_pct",
]);
const HOLDING_ONBOARDING_CONSTRAINTS = Object.freeze([
  "holding_onboarding_evidence_account_owner_fk",
  "holding_onboarding_evidence_asset_account_fk",
  "holding_onboarding_evidence_asset_owner_fk",
  "holding_onboarding_evidence_average_cost_check",
  "holding_onboarding_evidence_currency_check",
  "holding_onboarding_evidence_current_price_check",
  "holding_onboarding_evidence_owner_user_fk",
  "holding_onboarding_evidence_pkey",
  "holding_onboarding_evidence_policy_version_check",
  "holding_onboarding_evidence_price_source_check",
  "holding_onboarding_evidence_quantity_check",
  "holding_onboarding_evidence_reported_return_check",
]);
const PORTFOLIO_TARGET_POLICY_TABLES = Object.freeze([
  "portfolio_target_policy_lifecycle_events",
  "portfolio_target_policy_revisions",
  "portfolio_target_policy_rows",
]);
const PORTFOLIO_TARGET_POLICY_CONSTRAINTS = Object.freeze([
  "portfolio_target_events_audit_version_check",
  "portfolio_target_events_replacement_owner_fk",
  "portfolio_target_events_revision_owner_fk",
  "portfolio_target_events_sequence_check",
  "portfolio_target_events_transition_shape_check",
  "portfolio_target_revisions_account_owner_fk",
  "portfolio_target_revisions_authority_check",
  "portfolio_target_revisions_group_owner_fk",
  "portfolio_target_revisions_owner_user_fk",
  "portfolio_target_revisions_policy_version_check",
  "portfolio_target_revisions_revision_check",
  "portfolio_target_revisions_scope_kind_check",
  "portfolio_target_revisions_scope_shape_check",
  "portfolio_target_revisions_status_check",
  "portfolio_target_revisions_terminal_state_check",
  "portfolio_target_revisions_universe_hash_check",
  "portfolio_target_revisions_vector_hash_check",
  "portfolio_target_rows_account_owner_fk",
  "portfolio_target_rows_asset_account_fk",
  "portfolio_target_rows_asset_name_check",
  "portfolio_target_rows_asset_owner_fk",
  "portfolio_target_rows_buyability_check",
  "portfolio_target_rows_currency_check",
  "portfolio_target_rows_market_check",
  "portfolio_target_rows_positive_buyability_check",
  "portfolio_target_rows_revision_owner_fk",
  "portfolio_target_rows_ticker_check",
  "portfolio_target_rows_weight_check",
  "portfolio_target_policy_rows_pk",
]);

type Query = (query: string) => Promise<Record<string, unknown>[]>;

export type PreviewDatabaseState = {
  target: ReturnType<typeof guardPreviewDatabaseTarget>;
  rowCounts: {
    assets: number;
    priceSnapshots: number;
    fxRates: number;
    approvalRevisions: number;
    dailyPortfolioSnapshots: number;
    dailyPositionSnapshots: number;
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
    dailyPositionLegacyAssetIdNullable: boolean;
    snapshotOwnershipConstraints: string[];
    accountOwnerCodeUniqueIndexExact: boolean;
    assetAccountUniqueIndexExact: boolean;
    assetCanonicalOwnerUniqueIndexExact: boolean;
    portfolioGroupOwnerUniqueIndexExact: boolean;
    portfolioGroupAccountStartIndexExact: boolean;
    portfolioGroupAccountActiveIndexExact: boolean;
    portfolioGroupAssetStartIndexExact: boolean;
    portfolioGroupAssetActiveIndexExact: boolean;
    portfolioScopeTables: string[];
    portfolioScopeConstraints: string[];
    portfolioScopeRows: PortfolioScopeRowCounts | null;
    portfolioSnapshotIdentityIndexExact: boolean;
    positionSnapshotIdentityIndexExact: boolean;
    holdingOnboardingTables: string[];
    holdingOnboardingColumns: string[];
    holdingOnboardingConstraints: string[];
    holdingOnboardingEvidenceRows: number | null;
    holdingOnboardingAssetIndexExact: boolean;
    holdingOnboardingOwnerIndexExact: boolean;
    holdingOnboardingAccountIndexExact: boolean;
    assetOwnerAccountInstrumentIndexExact: boolean;
    portfolioTargetPolicyTables: string[];
    portfolioTargetPolicyConstraints: string[];
    portfolioTargetPolicyIndexes: string[];
    portfolioTargetPolicyRows: PortfolioTargetPolicyRowCounts | null;
    duplicateAssetIdentityGroups: number;
  };
};

export type TargetPolicyRowCounts = {
  revisions: number;
  vectorRows: number;
  lifecycleEvents: number;
};

export type PortfolioScopeRowCounts = {
  groups: number;
  accountMemberships: number;
  assetMemberships: number;
};

export type PortfolioTargetPolicyRowCounts = {
  revisions: number;
  rows: number;
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
    reviewedTableRows,
    constraintRows,
  ] = await Promise.all([
    input.query(`
      select
        (select count(*)::integer from assets) as assets,
        (select count(*)::integer from asset_price_snapshots) as price_snapshots,
        (select count(*)::integer from fx_rates) as fx_rates,
        (
          select count(*)::integer
            from simulation_scenario_approval_revisions
        ) as approval_revisions,
        (
          select count(*)::integer
            from daily_portfolio_snapshots
        ) as daily_portfolio_snapshots,
        (
          select count(*)::integer
            from daily_position_snapshots
        ) as daily_position_snapshots,
        (
          select count(*)::integer
            from (
              select 1
                from assets
               where canonical_owner_user_id is not null
                 and account_id is not null
                 and ticker is not null
               group by
                 canonical_owner_user_id,
                 account_id,
                 lower(btrim(market)),
                 upper(btrim(currency)),
                 upper(btrim(ticker))
              having count(*) > 1
            ) as duplicate_asset_identity
        ) as duplicate_asset_identity_groups
    `),
    input.query(`
      select hash, created_at::text as created_at
        from drizzle.__drizzle_migrations
       order by created_at asc
    `),
    input.query(`
      select table_name, column_name, is_nullable
        from information_schema.columns
       where table_schema = 'public'
         and (
           (
             table_name = 'asset_price_snapshots'
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
           )
           or (
             table_name = 'daily_position_snapshots'
             and column_name = 'legacy_asset_id'
           )
           or table_name = 'holding_onboarding_evidence'
         )
       order by table_name, column_name
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
        pg_get_expr(
          index_definition.indexprs,
          index_definition.indrelid
        ) as index_expressions,
        pg_get_expr(
          index_definition.indpred,
          index_definition.indrelid
        ) as index_predicate,
        index_definition.indnkeyatts::integer as key_attribute_count,
        index_definition.indnatts::integer as total_attribute_count,
        string_agg(
          coalesce(table_attribute.attname, ''),
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
          'assets',
          'daily_portfolio_snapshots',
          'daily_position_snapshots',
          'holding_onboarding_evidence',
          'portfolio_group_account_memberships',
          'portfolio_group_asset_memberships',
          'portfolio_groups',
          'portfolio_target_policy_lifecycle_events',
          'portfolio_target_policy_revisions',
          'target_policy_approval_revisions',
          'target_policy_approval_lifecycle_events'
        )
        and index_class.relname in (
          'asset_price_snapshots_instrument_date_unique',
          'asset_price_snapshots_ticker_date_unique',
          'accounts_id_canonical_owner_unique',
          'accounts_canonical_owner_code_unique',
          'assets_id_account_unique',
          'assets_id_canonical_owner_unique',
          'assets_owner_account_instrument_unique',
          'daily_portfolio_snapshots_date_account_source_unique',
          'daily_position_snapshots_date_account_asset_source_unique',
          'holding_onboarding_evidence_asset_unique',
          'holding_onboarding_evidence_owner_user_id_idx',
          'holding_onboarding_evidence_account_id_idx',
          'portfolio_group_account_memberships_start_unique',
          'portfolio_group_account_memberships_active_unique',
          'portfolio_group_asset_memberships_start_unique',
          'portfolio_group_asset_memberships_active_unique',
          'portfolio_groups_id_canonical_owner_unique',
          'portfolio_target_events_revision_sequence_unique',
          'portfolio_target_revisions_id_owner_unique',
          'portfolio_target_revisions_all_revision_unique',
          'portfolio_target_revisions_account_revision_unique',
          'portfolio_target_revisions_group_revision_unique',
          'portfolio_target_current_all_unique',
          'portfolio_target_current_account_unique',
          'portfolio_target_current_group_unique',
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
        pg_get_expr(index_definition.indexprs, index_definition.indrelid),
        pg_get_expr(index_definition.indpred, index_definition.indrelid),
        index_definition.indnkeyatts,
        index_definition.indnatts
      order by index_class.relname
    `),
    input.query(`
      select table_name
        from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'holding_onboarding_evidence',
           'portfolio_group_account_memberships',
           'portfolio_group_asset_memberships',
           'portfolio_groups',
           'portfolio_target_policy_lifecycle_events',
           'portfolio_target_policy_revisions',
           'portfolio_target_policy_rows',
           'target_policy_approval_lifecycle_events',
           'target_policy_approval_revisions',
           'target_policy_approval_vector_rows'
         )
       order by table_name
    `),
    input.query(`
      select table_class.relname as table_name,
             constraint_definition.conname as constraint_name,
             constraint_definition.contype as constraint_type,
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
           'target_policy_approval_lifecycle_events',
           'daily_portfolio_snapshots',
           'daily_position_snapshots',
           'holding_onboarding_evidence',
           'portfolio_group_account_memberships',
           'portfolio_group_asset_memberships',
           'portfolio_groups',
           'portfolio_target_policy_lifecycle_events',
           'portfolio_target_policy_revisions',
           'portfolio_target_policy_rows'
         )
       order by constraint_definition.conname
    `),
  ]);

  if (countRows.length !== 1) {
    throw new Error("Preview database row-count evidence is unavailable.");
  }

  const counts = countRows[0];
  const adjustedClosePrice = columnRows.find(
    ({ table_name, column_name }) =>
      table_name === "asset_price_snapshots" &&
      column_name === "adjusted_close_price",
  );
  const dailyPositionLegacyAssetId = columnRows.find(
    ({ table_name, column_name }) =>
      table_name === "daily_position_snapshots" &&
      column_name === "legacy_asset_id",
  );
  const presentColumns = REVIEWED_COLUMNS.filter((columnName) =>
    columnRows.some(
      ({ table_name, column_name }) =>
        table_name === "asset_price_snapshots" &&
        column_name === columnName,
    ),
  );
  const presentTargetPolicyTables = TARGET_POLICY_TABLES.filter((tableName) =>
    reviewedTableRows.some(({ table_name }) => table_name === tableName),
  );
  const presentPortfolioScopeTables = PORTFOLIO_SCOPE_TABLES.filter(
    (tableName) =>
      reviewedTableRows.some(({ table_name }) => table_name === tableName),
  );
  const presentHoldingOnboardingTables = HOLDING_ONBOARDING_TABLES.filter(
    (tableName) =>
      reviewedTableRows.some(
        ({ table_name }) => table_name === tableName,
      ),
  );
  const presentPortfolioTargetPolicyTables =
    PORTFOLIO_TARGET_POLICY_TABLES.filter((tableName) =>
      reviewedTableRows.some(({ table_name }) => table_name === tableName),
    );
  const presentHoldingOnboardingColumns = HOLDING_ONBOARDING_COLUMNS.filter(
    (columnName) =>
      columnRows.some(
        ({ table_name, column_name }) =>
          table_name === "holding_onboarding_evidence" &&
          column_name === columnName,
      ),
  );
  const presentTargetPolicyConstraints = TARGET_POLICY_CONSTRAINTS.filter(
    (constraintName) =>
      constraintRows.some(
        ({ constraint_name, is_validated }) =>
          constraint_name === constraintName && is_validated === true,
      ),
  );
  const presentPortfolioScopeConstraints = PORTFOLIO_SCOPE_CONSTRAINTS.filter(
    (constraintName) =>
      constraintRows.some(
        ({ constraint_name, is_validated }) =>
          constraint_name === constraintName && is_validated === true,
      ),
  );
  const presentHoldingOnboardingConstraints =
    HOLDING_ONBOARDING_CONSTRAINTS.filter((constraintName) =>
      constraintRows.some(
        ({ constraint_name, is_validated }) =>
          constraint_name === constraintName && is_validated === true,
      ),
    );
  const presentPortfolioTargetPolicyConstraints =
    PORTFOLIO_TARGET_POLICY_CONSTRAINTS.filter((constraintName) =>
      constraintRows.some(
        ({ constraint_name, is_validated }) =>
          constraint_name === constraintName && is_validated === true,
      ),
    );
  const presentPortfolioTargetPolicyIndexes =
    PORTFOLIO_TARGET_POLICY_INDEXES.filter((expected) =>
      hasExactUniqueIndex(indexRows, expected),
    ).map(({ name }) => name);
  const presentSnapshotOwnershipConstraints =
    SNAPSHOT_OWNERSHIP_CONSTRAINTS.filter((expected) =>
      constraintRows.some(
        ({
          table_name,
          constraint_name,
          constraint_type,
          is_validated,
        }) =>
          table_name === expected.table &&
          constraint_name === expected.name &&
          constraint_type === expected.type &&
          (expected.validated === null ||
            is_validated === expected.validated),
      ),
    ).map(({ name }) => name);
  const targetPolicyRows =
    presentTargetPolicyTables.length === TARGET_POLICY_TABLES.length
      ? await readTargetPolicyRowCounts(input.query)
      : null;
  const portfolioScopeRows =
    presentPortfolioScopeTables.length === PORTFOLIO_SCOPE_TABLES.length
      ? await readPortfolioScopeRowCounts(input.query)
      : null;
  const holdingOnboardingEvidenceRows =
    presentHoldingOnboardingTables.length === HOLDING_ONBOARDING_TABLES.length
      ? await readHoldingOnboardingEvidenceRowCount(input.query)
      : null;
  const portfolioTargetPolicyRows =
    presentPortfolioTargetPolicyTables.length ===
    PORTFOLIO_TARGET_POLICY_TABLES.length
      ? await readPortfolioTargetPolicyRowCounts(input.query)
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
      dailyPortfolioSnapshots: integerValue(
        counts.daily_portfolio_snapshots,
        "daily portfolio snapshots",
      ),
      dailyPositionSnapshots: integerValue(
        counts.daily_position_snapshots,
        "daily position snapshots",
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
      dailyPositionLegacyAssetIdNullable:
        dailyPositionLegacyAssetId?.is_nullable === "YES",
      snapshotOwnershipConstraints:
        presentSnapshotOwnershipConstraints,
      accountOwnerCodeUniqueIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.accountOwnerCode,
      ),
      assetAccountUniqueIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.assetAccount,
      ),
      assetCanonicalOwnerUniqueIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.assetCanonicalOwner,
      ),
      portfolioGroupOwnerUniqueIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.portfolioGroupOwner,
      ),
      portfolioGroupAccountStartIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.portfolioGroupAccountStart,
      ),
      portfolioGroupAccountActiveIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.portfolioGroupAccountActive,
      ),
      portfolioGroupAssetStartIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.portfolioGroupAssetStart,
      ),
      portfolioGroupAssetActiveIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.portfolioGroupAssetActive,
      ),
      portfolioScopeTables: presentPortfolioScopeTables,
      portfolioScopeConstraints: presentPortfolioScopeConstraints,
      portfolioScopeRows,
      portfolioSnapshotIdentityIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.portfolioSnapshotIdentity,
      ),
      positionSnapshotIdentityIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.positionSnapshotIdentity,
      ),
      holdingOnboardingTables: presentHoldingOnboardingTables,
      holdingOnboardingColumns: presentHoldingOnboardingColumns,
      holdingOnboardingConstraints: presentHoldingOnboardingConstraints,
      holdingOnboardingEvidenceRows,
      holdingOnboardingAssetIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.holdingOnboardingAsset,
      ),
      holdingOnboardingOwnerIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.holdingOnboardingOwner,
      ),
      holdingOnboardingAccountIndexExact: hasExactUniqueIndex(
        indexRows,
        REVIEWED_INDEXES.holdingOnboardingAccount,
      ),
      assetOwnerAccountInstrumentIndexExact:
        hasExactAssetOwnerAccountInstrumentIndex(indexRows),
      portfolioTargetPolicyTables: presentPortfolioTargetPolicyTables,
      portfolioTargetPolicyConstraints:
        presentPortfolioTargetPolicyConstraints,
      portfolioTargetPolicyIndexes: presentPortfolioTargetPolicyIndexes,
      portfolioTargetPolicyRows,
      duplicateAssetIdentityGroups: integerValue(
        counts.duplicate_asset_identity_groups,
        "duplicate asset identity groups",
      ),
    },
  };
}

export function assertReviewedPreviewDatabaseState(
  state: PreviewDatabaseState,
) {
  if (!hasReviewedMigrationLedger(state)) {
    throw new Error(
      "Preview database migration ledger does not match the reviewed 0031 ledger.",
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
  assertReviewedPrePortfolioTargetPolicyPreviewDatabaseCatalog(state);
  if (!hasReviewedCatalog(state)) {
    const publicEvidence = publicPreviewDatabaseEvidence(state);
    const catalog = state.reviewedCatalog;
    throw new Error(
      `Preview database reviewed 0026 catalog is incomplete. ${JSON.stringify(
        {
          portfolioTargetPolicyCatalogStatus:
            publicEvidence.portfolioTargetPolicyCatalogStatus,
          portfolioTargetPolicyTableCount:
            catalog.portfolioTargetPolicyTables.length,
          portfolioTargetPolicyConstraintCount:
            catalog.portfolioTargetPolicyConstraints.length,
          portfolioTargetPolicyIndexCount:
            catalog.portfolioTargetPolicyIndexes.length,
          portfolioTargetPolicyRowsAvailable:
            catalog.portfolioTargetPolicyRows !== null,
        },
      )}`,
    );
  }
}

export function assertReviewedPrePortfolioTargetPolicyPreviewDatabaseCatalog(
  state: PreviewDatabaseState,
) {
  if (!hasReviewedPrePortfolioTargetPolicyCatalog(state)) {
    const publicEvidence = publicPreviewDatabaseEvidence(state);
    const catalog = state.reviewedCatalog;
    throw new Error(
      `Preview database reviewed 0025 catalog is incomplete. ${JSON.stringify(
        {
          holdingOnboardingCatalogStatus:
            publicEvidence.holdingOnboardingCatalogStatus,
          holdingOnboardingTableCount: catalog.holdingOnboardingTables.length,
          holdingOnboardingColumnCount:
            catalog.holdingOnboardingColumns.length,
          holdingOnboardingConstraintCount:
            catalog.holdingOnboardingConstraints.length,
          holdingOnboardingRowsAvailable:
            catalog.holdingOnboardingEvidenceRows !== null,
          holdingOnboardingAssetIndexExact:
            catalog.holdingOnboardingAssetIndexExact,
          holdingOnboardingOwnerIndexExact:
            catalog.holdingOnboardingOwnerIndexExact,
          holdingOnboardingAccountIndexExact:
            catalog.holdingOnboardingAccountIndexExact,
          assetOwnerAccountInstrumentIndexExact:
            catalog.assetOwnerAccountInstrumentIndexExact,
          duplicateAssetIdentityGroups:
            catalog.duplicateAssetIdentityGroups,
        },
      )}`,
    );
  }
}

export function assertReviewedPreHoldingOnboardingPreviewDatabaseCatalog(
  state: PreviewDatabaseState,
) {
  if (
    !hasReviewedPreHoldingOnboardingCatalog(state) ||
    state.reviewedCatalog.duplicateAssetIdentityGroups !== 0
  ) {
    const publicEvidence = publicPreviewDatabaseEvidence(state);
    const catalog = state.reviewedCatalog;
    throw new Error(
      `Preview database reviewed 0024 prerequisite catalog is incomplete. ${JSON.stringify(
        {
          assetPriceCatalogStatus: publicEvidence.assetPriceCatalogStatus,
          targetPolicyCatalogStatus: publicEvidence.targetPolicyCatalogStatus,
          snapshotOwnershipCatalogStatus:
            publicEvidence.snapshotOwnershipCatalogStatus,
          portfolioScopeCatalogStatus:
            publicEvidence.portfolioScopeCatalogStatus,
          portfolioScopeTableCount: catalog.portfolioScopeTables.length,
          portfolioScopeConstraintCount:
            catalog.portfolioScopeConstraints.length,
          portfolioScopeRowsAvailable: catalog.portfolioScopeRows !== null,
          assetCanonicalOwnerUniqueIndexExact:
            catalog.assetCanonicalOwnerUniqueIndexExact,
          portfolioGroupOwnerUniqueIndexExact:
            catalog.portfolioGroupOwnerUniqueIndexExact,
          portfolioGroupAccountStartIndexExact:
            catalog.portfolioGroupAccountStartIndexExact,
          portfolioGroupAccountActiveIndexExact:
            catalog.portfolioGroupAccountActiveIndexExact,
          portfolioGroupAssetStartIndexExact:
            catalog.portfolioGroupAssetStartIndexExact,
          portfolioGroupAssetActiveIndexExact:
            catalog.portfolioGroupAssetActiveIndexExact,
          duplicateAssetIdentityGroups:
            catalog.duplicateAssetIdentityGroups,
        },
      )}`,
    );
  }
}

export function assertReviewedPrePortfolioScopePreviewDatabaseCatalog(
  state: PreviewDatabaseState,
) {
  if (!hasReviewedPrePortfolioScopeCatalog(state)) {
    throw new Error(
      "Preview database reviewed 0023 prerequisite catalog is incomplete.",
    );
  }
}

export function assertReviewedPreSnapshotOwnerPreviewDatabaseCatalog(
  state: PreviewDatabaseState,
) {
  if (
    !hasReviewedAssetPriceCatalog(state) ||
    !hasReviewedTargetPolicyCatalog(state)
  ) {
    throw new Error(
      "Preview database reviewed 0022 prerequisite catalog is incomplete.",
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

export function assertPreviewPortfolioScopeRowsPreserved(
  before: PortfolioScopeRowCounts | null,
  after: PortfolioScopeRowCounts | null,
) {
  if (after === null) {
    throw new Error(
      "Preview postflight portfolio-scope row evidence is unavailable.",
    );
  }

  const expected = before ?? {
    groups: 0,
    accountMemberships: 0,
    assetMemberships: 0,
  };
  if (
    after.groups !== expected.groups ||
    after.accountMemberships !== expected.accountMemberships ||
    after.assetMemberships !== expected.assetMemberships
  ) {
    throw new Error(
      before === null
        ? "Preview migration unexpectedly seeded portfolio-scope rows."
        : "Preview migration changed inherited portfolio-scope row counts.",
    );
  }
}

export function assertPreviewHoldingOnboardingRowsPreserved(
  before: number | null,
  after: number | null,
) {
  if (after === null) {
    throw new Error(
      "Preview postflight holding-onboarding row evidence is unavailable.",
    );
  }

  const expected = before ?? 0;
  if (after !== expected) {
    throw new Error(
      before === null
        ? "Preview migration unexpectedly seeded holding-onboarding rows."
        : "Preview migration changed inherited holding-onboarding row counts.",
    );
  }
}

export function assertPreviewPortfolioTargetPolicyRowsPreserved(
  before: PortfolioTargetPolicyRowCounts | null,
  after: PortfolioTargetPolicyRowCounts | null,
) {
  if (after === null) {
    throw new Error(
      "Preview postflight portfolio target-policy row evidence is unavailable.",
    );
  }

  const expected = before ?? {
    revisions: 0,
    rows: 0,
    lifecycleEvents: 0,
  };
  if (
    after.revisions !== expected.revisions ||
    after.rows !== expected.rows ||
    after.lifecycleEvents !== expected.lifecycleEvents
  ) {
    throw new Error(
      before === null
        ? "Preview migration unexpectedly seeded portfolio target-policy rows."
        : "Preview migration changed inherited portfolio target-policy row counts.",
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
  const reviewedSnapshotOwnershipCatalogPresent =
    hasReviewedSnapshotOwnershipCatalog(state);
  const reviewedPortfolioScopeCatalogPresent =
    hasReviewedPortfolioScopeCatalog(state);
  const reviewedHoldingOnboardingCatalogPresent =
    hasReviewedHoldingOnboardingCatalog(state);
  const reviewedPortfolioTargetPolicyCatalogPresent =
    hasReviewedPortfolioTargetPolicyCatalog(state);
  return {
    evidenceVersion: "preview_database_evidence_v13",
    status: "operational_guard_passed",
    targetFingerprint: state.target.targetFingerprint,
    endpointProjectBinding: state.target.endpointProjectBinding,
    rowCounts: state.rowCounts,
    latestReviewedMigration: reviewedMigrationPresent
      ? PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration.tag
      : null,
    migrationLedgerStatus: reviewedMigrationLedgerPresent
      ? "reviewed_0031_present"
      : "reviewed_0031_not_present",
    assetPriceCatalogStatus: reviewedAssetPriceCatalogPresent
      ? "reviewed_0020_present"
      : "reviewed_0020_not_present",
    targetPolicyCatalogStatus: reviewedTargetPolicyCatalogPresent
      ? "reviewed_0022_present"
      : "reviewed_0022_not_present",
    snapshotOwnershipCatalogStatus: reviewedSnapshotOwnershipCatalogPresent
      ? "reviewed_0023_present"
      : "reviewed_0023_not_present",
    portfolioScopeCatalogStatus: reviewedPortfolioScopeCatalogPresent
      ? "reviewed_0024_present"
      : "reviewed_0024_not_present",
    holdingOnboardingCatalogStatus: reviewedHoldingOnboardingCatalogPresent
      ? "reviewed_0025_present"
      : "reviewed_0025_not_present",
    portfolioTargetPolicyCatalogStatus:
      reviewedPortfolioTargetPolicyCatalogPresent
        ? "reviewed_0026_present"
        : "reviewed_0026_not_present",
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
    hasReviewedPrePortfolioTargetPolicyCatalog(state) &&
    hasReviewedPortfolioTargetPolicyCatalog(state)
  );
}

function hasReviewedPrePortfolioTargetPolicyCatalog(
  state: PreviewDatabaseState,
) {
  return (
    hasReviewedPreHoldingOnboardingCatalog(state) &&
    hasReviewedHoldingOnboardingCatalog(state)
  );
}

function hasReviewedPreHoldingOnboardingCatalog(state: PreviewDatabaseState) {
  return (
    hasReviewedPrePortfolioScopeCatalog(state) &&
    hasReviewedPortfolioScopeCatalog(state)
  );
}

function hasReviewedPrePortfolioScopeCatalog(state: PreviewDatabaseState) {
  return (
    hasReviewedAssetPriceCatalog(state) &&
    hasReviewedTargetPolicyCatalog(state) &&
    hasReviewedSnapshotOwnershipCatalog(state)
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

function hasReviewedSnapshotOwnershipCatalog(state: PreviewDatabaseState) {
  return (
    state.reviewedCatalog.dailyPositionLegacyAssetIdNullable &&
    state.reviewedCatalog.snapshotOwnershipConstraints.length ===
      SNAPSHOT_OWNERSHIP_CONSTRAINTS.length &&
    state.reviewedCatalog.accountOwnerCodeUniqueIndexExact &&
    state.reviewedCatalog.assetAccountUniqueIndexExact &&
    state.reviewedCatalog.portfolioSnapshotIdentityIndexExact &&
    state.reviewedCatalog.positionSnapshotIdentityIndexExact
  );
}

function hasReviewedPortfolioScopeCatalog(state: PreviewDatabaseState) {
  return (
    state.reviewedCatalog.portfolioScopeTables.length ===
      PORTFOLIO_SCOPE_TABLES.length &&
    state.reviewedCatalog.portfolioScopeConstraints.length ===
      PORTFOLIO_SCOPE_CONSTRAINTS.length &&
    state.reviewedCatalog.portfolioScopeRows !== null &&
    state.reviewedCatalog.assetCanonicalOwnerUniqueIndexExact &&
    state.reviewedCatalog.portfolioGroupOwnerUniqueIndexExact &&
    state.reviewedCatalog.portfolioGroupAccountStartIndexExact &&
    state.reviewedCatalog.portfolioGroupAccountActiveIndexExact &&
    state.reviewedCatalog.portfolioGroupAssetStartIndexExact &&
    state.reviewedCatalog.portfolioGroupAssetActiveIndexExact
  );
}

function hasReviewedHoldingOnboardingCatalog(state: PreviewDatabaseState) {
  return (
    state.reviewedCatalog.holdingOnboardingTables.length ===
      HOLDING_ONBOARDING_TABLES.length &&
    state.reviewedCatalog.holdingOnboardingColumns.length ===
      HOLDING_ONBOARDING_COLUMNS.length &&
    state.reviewedCatalog.holdingOnboardingConstraints.length ===
      HOLDING_ONBOARDING_CONSTRAINTS.length &&
    state.reviewedCatalog.holdingOnboardingEvidenceRows !== null &&
    state.reviewedCatalog.holdingOnboardingAssetIndexExact &&
    state.reviewedCatalog.holdingOnboardingOwnerIndexExact &&
    state.reviewedCatalog.holdingOnboardingAccountIndexExact &&
    state.reviewedCatalog.assetOwnerAccountInstrumentIndexExact &&
    state.reviewedCatalog.duplicateAssetIdentityGroups === 0
  );
}

function hasReviewedPortfolioTargetPolicyCatalog(
  state: PreviewDatabaseState,
) {
  return (
    state.reviewedCatalog.portfolioTargetPolicyTables.length ===
      PORTFOLIO_TARGET_POLICY_TABLES.length &&
    state.reviewedCatalog.portfolioTargetPolicyConstraints.length ===
      PORTFOLIO_TARGET_POLICY_CONSTRAINTS.length &&
    state.reviewedCatalog.portfolioTargetPolicyIndexes.length ===
      PORTFOLIO_TARGET_POLICY_INDEXES.length &&
    state.reviewedCatalog.portfolioTargetPolicyRows !== null
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

function hasExactAssetOwnerAccountInstrumentIndex(
  rows: Record<string, unknown>[],
) {
  const matching = rows.filter(
    ({ index_name }) => index_name === "assets_owner_account_instrument_unique",
  );
  if (matching.length !== 1) return false;

  const row = matching[0];
  const expressions = normalizeSqlEvidence(row.index_expressions);
  const predicate = normalizeSqlEvidence(row.index_predicate);
  return (
    row.is_valid === true &&
    row.is_unique === true &&
    row.is_ready === true &&
    row.is_live === true &&
    row.has_no_predicate === false &&
    row.has_no_expressions === false &&
    Number(row.key_attribute_count) === 5 &&
    Number(row.total_attribute_count) === 5 &&
    row.key_columns === "canonical_owner_user_id,account_id,,," &&
    expressions.includes("lower(btrim((market)::text))") &&
    expressions.includes("upper(btrim((currency)::text))") &&
    expressions.includes("upper(btrim((ticker)::text))") &&
    predicate.includes("canonical_owner_user_id is not null") &&
    predicate.includes("account_id is not null") &&
    predicate.includes("ticker is not null")
  );
}

function normalizeSqlEvidence(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/\s+/g, " ").trim()
    : "";
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

async function readPortfolioScopeRowCounts(query: Query) {
  const rows = await query(`
    select
      (
        select count(*)::integer
          from portfolio_groups
      ) as groups,
      (
        select count(*)::integer
          from portfolio_group_account_memberships
      ) as account_memberships,
      (
        select count(*)::integer
          from portfolio_group_asset_memberships
      ) as asset_memberships
  `);
  if (rows.length !== 1) {
    throw new Error(
      "Preview database portfolio-scope row evidence is unavailable.",
    );
  }
  return {
    groups: integerValue(rows[0].groups, "portfolio groups"),
    accountMemberships: integerValue(
      rows[0].account_memberships,
      "portfolio group account memberships",
    ),
    assetMemberships: integerValue(
      rows[0].asset_memberships,
      "portfolio group asset memberships",
    ),
  };
}

async function readHoldingOnboardingEvidenceRowCount(query: Query) {
  const rows = await query(`
    select count(*)::integer as evidence_rows
      from holding_onboarding_evidence
  `);
  if (rows.length !== 1) {
    throw new Error(
      "Preview database holding-onboarding row evidence is unavailable.",
    );
  }
  return integerValue(
    rows[0].evidence_rows,
    "holding onboarding evidence rows",
  );
}

async function readPortfolioTargetPolicyRowCounts(query: Query) {
  const rows = await query(`
    select
      (
        select count(*)::integer
          from portfolio_target_policy_revisions
      ) as revisions,
      (
        select count(*)::integer
          from portfolio_target_policy_rows
      ) as policy_rows,
      (
        select count(*)::integer
          from portfolio_target_policy_lifecycle_events
      ) as lifecycle_events
  `);
  if (rows.length !== 1) {
    throw new Error(
      "Preview database portfolio target-policy row evidence is unavailable.",
    );
  }
  return {
    revisions: integerValue(
      rows[0].revisions,
      "portfolio target-policy revisions",
    ),
    rows: integerValue(rows[0].policy_rows, "portfolio target-policy rows"),
    lifecycleEvents: integerValue(
      rows[0].lifecycle_events,
      "portfolio target-policy lifecycle events",
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
