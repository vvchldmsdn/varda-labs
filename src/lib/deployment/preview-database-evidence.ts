import {
  PREVIEW_DATABASE_TARGET_GUARD_POLICY,
  guardPreviewDatabaseTarget,
  type PreviewDatabaseTargetGuardEnvironment,
} from "./preview-database-target.ts";

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
  }),
  legacyTickerDate: Object.freeze({
    name: "asset_price_snapshots_ticker_date_unique",
    columns: Object.freeze(["ticker", "date"]),
  }),
});

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
  reviewedCatalog: {
    adjustedClosePriceNullable: boolean;
    presentColumns: string[];
    instrumentDateUniqueIndexExact: boolean;
    legacyTickerDateUniqueIndexExact: boolean;
    legacyTickerDateIndexPresent: boolean;
  };
};

export async function readPreviewDatabaseState(input: {
  env: PreviewDatabaseTargetGuardEnvironment;
  query: Query;
}): Promise<PreviewDatabaseState> {
  const target = guardPreviewDatabaseTarget(input.env);
  const [countRows, migrationRows, columnRows, indexRows] = await Promise.all([
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
       order by created_at desc
       limit 1
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
        and table_class.relname = 'asset_price_snapshots'
        and index_class.relname in (
          'asset_price_snapshots_instrument_date_unique',
          'asset_price_snapshots_ticker_date_unique'
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
    latestMigration:
      migrationRows.length === 1
        ? {
            createdAt: integerValue(
              migrationRows[0].created_at,
              "latest migration timestamp",
            ),
            sha256: String(migrationRows[0].hash ?? ""),
          }
        : null,
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
    },
  };
}

export function assertReviewedPreviewDatabaseState(
  state: PreviewDatabaseState,
) {
  if (!hasReviewedLatestMigration(state)) {
    throw new Error(
      `Preview database latest migration is not ${PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration.tag}.`,
    );
  }
  if (!hasReviewedCatalog(state)) {
    throw new Error(
      "Preview database reviewed 0020 catalog is incomplete.",
    );
  }
}

export function publicPreviewDatabaseEvidence(state: PreviewDatabaseState) {
  const reviewedMigrationPresent = hasReviewedLatestMigration(state);
  const reviewedCatalogPresent = hasReviewedCatalog(state);
  return {
    evidenceVersion: "preview_database_evidence_v3",
    status: "operational_guard_passed",
    targetFingerprint: state.target.targetFingerprint,
    endpointProjectBinding: state.target.endpointProjectBinding,
    rowCounts: state.rowCounts,
    latestReviewedMigration: reviewedMigrationPresent
      ? PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration.tag
      : null,
    catalogStatus:
      reviewedMigrationPresent && reviewedCatalogPresent
        ? "reviewed_0020_present"
        : "reviewed_0020_not_present",
  };
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
    state.reviewedCatalog.adjustedClosePriceNullable &&
    state.reviewedCatalog.presentColumns.length === REVIEWED_COLUMNS.length &&
    state.reviewedCatalog.instrumentDateUniqueIndexExact &&
    !state.reviewedCatalog.legacyTickerDateIndexPresent
  );
}

function hasNamedIndex(rows: Record<string, unknown>[], name: string) {
  return rows.some(({ index_name }) => index_name === name);
}

function hasExactUniqueIndex(
  rows: Record<string, unknown>[],
  expected: { name: string; columns: readonly string[] },
) {
  const matching = rows.filter(({ index_name }) => index_name === expected.name);
  if (matching.length !== 1) return false;

  const row = matching[0];
  return (
    row.is_valid === true &&
    row.is_unique === true &&
    row.is_ready === true &&
    row.is_live === true &&
    row.has_no_predicate === true &&
    row.has_no_expressions === true &&
    Number(row.key_attribute_count) === expected.columns.length &&
    Number(row.total_attribute_count) === expected.columns.length &&
    row.key_columns === expected.columns.join(",")
  );
}

function integerValue(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Preview database ${label} evidence is invalid.`);
  }
  return parsed;
}
