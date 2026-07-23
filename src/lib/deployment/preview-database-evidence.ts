import {
  PREVIEW_DATABASE_TARGET_POLICY,
  attestPreviewDatabaseTarget,
  type PreviewDatabaseTargetEnvironment,
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

type Query = (query: string) => Promise<Record<string, unknown>[]>;

export type PreviewDatabaseState = {
  target: ReturnType<typeof attestPreviewDatabaseTarget>;
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
    instrumentDateUniqueIndex: boolean;
  };
};

export async function readPreviewDatabaseState(input: {
  env: PreviewDatabaseTargetEnvironment;
  query: Query;
}): Promise<PreviewDatabaseState> {
  const target = attestPreviewDatabaseTarget(input.env);
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
      select indexname
        from pg_catalog.pg_indexes
       where schemaname = 'public'
         and tablename = 'asset_price_snapshots'
         and indexname = 'asset_price_snapshots_instrument_date_unique'
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
      instrumentDateUniqueIndex: indexRows.length === 1,
    },
  };
}

export function assertReviewedPreviewDatabaseState(
  state: PreviewDatabaseState,
) {
  if (!hasReviewedLatestMigration(state)) {
    throw new Error(
      `Preview database latest migration is not ${PREVIEW_DATABASE_TARGET_POLICY.latestReviewedMigration.tag}.`,
    );
  }
  if (!hasReviewedCatalog(state)) {
    throw new Error(
      "Preview database reviewed 0019 catalog is incomplete.",
    );
  }
}

export function publicPreviewDatabaseEvidence(state: PreviewDatabaseState) {
  const reviewedMigrationPresent = hasReviewedLatestMigration(state);
  const reviewedCatalogPresent = hasReviewedCatalog(state);
  return {
    evidenceVersion: "preview_database_evidence_v1",
    status: "attested",
    targetFingerprint: state.target.targetFingerprint,
    rowCounts: state.rowCounts,
    latestReviewedMigration: reviewedMigrationPresent
      ? PREVIEW_DATABASE_TARGET_POLICY.latestReviewedMigration.tag
      : null,
    catalogStatus:
      reviewedMigrationPresent && reviewedCatalogPresent
        ? "reviewed_0019_present"
        : "reviewed_0019_not_present",
  };
}

function hasReviewedLatestMigration(state: PreviewDatabaseState) {
  const reviewed = PREVIEW_DATABASE_TARGET_POLICY.latestReviewedMigration;
  return (
    state.latestMigration?.createdAt === reviewed.createdAt &&
    state.latestMigration.sha256 === reviewed.sha256
  );
}

function hasReviewedCatalog(state: PreviewDatabaseState) {
  return (
    state.reviewedCatalog.adjustedClosePriceNullable &&
    state.reviewedCatalog.presentColumns.length === REVIEWED_COLUMNS.length &&
    state.reviewedCatalog.instrumentDateUniqueIndex
  );
}

function integerValue(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Preview database ${label} evidence is invalid.`);
  }
  return parsed;
}
