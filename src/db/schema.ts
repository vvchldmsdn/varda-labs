import {
  boolean,
  check,
  date,
  decimal,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: varchar("status", { length: 20 })
      .default("provisioning")
      .notNull(),
    role: varchar("role", { length: 20 }).default("user").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    statusCheck: check(
      "app_users_status_check",
      sql`${table.status} in ('provisioning', 'active', 'disabled')`,
    ),
    roleCheck: check(
      "app_users_role_check",
      sql`${table.role} in ('user', 'admin')`,
    ),
  }),
);

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id").notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    providerSubject: varchar("provider_subject", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    appUserFk: foreignKey({
      name: "auth_identities_app_user_id_app_users_id_fk",
      columns: [table.appUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    statusCheck: check(
      "auth_identities_status_check",
      sql`${table.status} in ('active', 'disabled')`,
    ),
    providerCheck: check(
      "auth_identities_provider_check",
      sql`${table.provider} = lower(btrim(${table.provider})) and char_length(${table.provider}) > 0`,
    ),
    providerSubjectCheck: check(
      "auth_identities_provider_subject_check",
      sql`${table.providerSubject} = btrim(${table.providerSubject}) and char_length(${table.providerSubject}) > 0`,
    ),
    disabledStateCheck: check(
      "auth_identities_disabled_state_check",
      sql`(${table.status} = 'active' and ${table.disabledAt} is null) or (${table.status} = 'disabled' and ${table.disabledAt} is not null)`,
    ),
    providerSubjectUnique: uniqueIndex(
      "auth_identities_provider_subject_unique",
    ).on(table.provider, table.providerSubject),
    appUserIdx: index("auth_identities_app_user_id_idx").on(table.appUserId),
    activeAppUserProviderUnique: uniqueIndex(
      "auth_identities_active_app_user_provider_unique",
    )
      .on(table.appUserId, table.provider)
      .where(sql`${table.status} = 'active'`),
  }),
);

export const simulationScenarioApprovalRevisions = pgTable(
  "simulation_scenario_approval_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull(),
    portfolioPathPolicyId: varchar("portfolio_path_policy_id", {
      length: 100,
    }).notNull(),
    gate0ApprovalCommit: varchar("gate0_approval_commit", {
      length: 40,
    }).notNull(),
    scenarioId: varchar("scenario_id", { length: 100 }).notNull(),
    scenarioVersion: varchar("scenario_version", { length: 100 }).notNull(),
    approvalRevision: integer("approval_revision").notNull(),
    scenarioVectorHashVersion: varchar("scenario_vector_hash_version", {
      length: 64,
    }).notNull(),
    scenarioVectorHash: varchar("scenario_vector_hash", {
      length: 71,
    }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 20 }).notNull(),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
  },
  (table) => ({
    ownerUserFk: foreignKey({
      name: "sim_scenario_approval_revisions_owner_user_fk",
      columns: [table.ownerUserId],
      foreignColumns: [appUsers.id],
    }).onDelete("restrict"),
    policyIdCheck: check(
      "sim_scenario_approval_revisions_policy_id_check",
      sql`${table.portfolioPathPolicyId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'`,
    ),
    gate0CommitCheck: check(
      "sim_scenario_approval_revisions_gate0_commit_check",
      sql`${table.gate0ApprovalCommit} ~ '^[0-9a-f]{40}$'`,
    ),
    scenarioIdCheck: check(
      "sim_scenario_approval_revisions_scenario_id_check",
      sql`${table.scenarioId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'`,
    ),
    scenarioVersionCheck: check(
      "sim_scenario_approval_revisions_scenario_version_check",
      sql`${table.scenarioVersion} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'`,
    ),
    revisionCheck: check(
      "sim_scenario_approval_revisions_revision_check",
      sql`${table.approvalRevision} > 0`,
    ),
    vectorHashVersionCheck: check(
      "sim_scenario_approval_revisions_vector_hash_version_check",
      sql`${table.scenarioVectorHashVersion} = 'simulation_scenario_vector_hash_v2'`,
    ),
    vectorHashCheck: check(
      "sim_scenario_approval_revisions_vector_hash_check",
      sql`${table.scenarioVectorHash} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    lifecycleStatusCheck: check(
      "sim_scenario_approval_revisions_lifecycle_status_check",
      sql`${table.lifecycleStatus} in ('approved', 'revoked', 'superseded')`,
    ),
    terminalStateCheck: check(
      "sim_scenario_approval_revisions_terminal_state_check",
      sql`(${table.lifecycleStatus} = 'approved' and ${table.terminalAt} is null) or (${table.lifecycleStatus} in ('revoked', 'superseded') and ${table.terminalAt} is not null and ${table.terminalAt} >= ${table.approvedAt})`,
    ),
    identityRevisionUnique: uniqueIndex(
      "sim_scenario_approval_revisions_identity_revision_unique",
    ).on(
      table.ownerUserId,
      table.portfolioPathPolicyId,
      table.gate0ApprovalCommit,
      table.scenarioId,
      table.scenarioVersion,
      table.approvalRevision,
    ),
    currentUnique: uniqueIndex(
      "sim_scenario_approval_revisions_current_unique",
    )
      .on(
        table.ownerUserId,
        table.portfolioPathPolicyId,
        table.gate0ApprovalCommit,
        table.scenarioId,
        table.scenarioVersion,
      )
      .where(sql`${table.lifecycleStatus} = 'approved'`),
  }),
);

export const simulationScenarioApprovalVectorRows = pgTable(
  "simulation_scenario_approval_vector_rows",
  {
    approvalRevisionId: uuid("approval_revision_id").notNull(),
    market: varchar("market", { length: 20 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    ticker: varchar("ticker", { length: 50 }).notNull(),
    weightBps: integer("weight_bps").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "sim_scenario_approval_vector_rows_pk",
      columns: [
        table.approvalRevisionId,
        table.market,
        table.currency,
        table.ticker,
      ],
    }),
    revisionFk: foreignKey({
      name: "sim_scenario_approval_vector_rows_revision_fk",
      columns: [table.approvalRevisionId],
      foreignColumns: [simulationScenarioApprovalRevisions.id],
    }).onDelete("restrict"),
    marketCheck: check(
      "sim_scenario_approval_vector_rows_market_check",
      sql`${table.market} = lower(btrim(${table.market})) and char_length(${table.market}) > 0`,
    ),
    currencyCheck: check(
      "sim_scenario_approval_vector_rows_currency_check",
      sql`${table.currency} = upper(btrim(${table.currency})) and char_length(${table.currency}) > 0`,
    ),
    tickerCheck: check(
      "sim_scenario_approval_vector_rows_ticker_check",
      sql`${table.ticker} = upper(btrim(${table.ticker})) and char_length(${table.ticker}) > 0`,
    ),
    weightCheck: check(
      "sim_scenario_approval_vector_rows_weight_check",
      sql`${table.weightBps} between 0 and 10000`,
    ),
  }),
);

export const simulationScenarioApprovalLifecycleEvents = pgTable(
  "simulation_scenario_approval_lifecycle_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    approvalRevisionId: uuid("approval_revision_id").notNull(),
    eventSequence: integer("event_sequence").notNull(),
    auditVersion: varchar("audit_version", { length: 50 }).notNull(),
    transitionKind: varchar("transition_kind", { length: 32 }).notNull(),
    previousStatus: varchar("previous_status", { length: 20 }),
    resultingStatus: varchar("resulting_status", { length: 20 }).notNull(),
    transitionedAt: timestamp("transitioned_at", {
      withTimezone: true,
    }).notNull(),
    replacementRevisionId: uuid("replacement_revision_id"),
  },
  (table) => ({
    revisionFk: foreignKey({
      name: "sim_scenario_approval_events_revision_fk",
      columns: [table.approvalRevisionId],
      foreignColumns: [simulationScenarioApprovalRevisions.id],
    }).onDelete("restrict"),
    replacementFk: foreignKey({
      name: "sim_scenario_approval_events_replacement_fk",
      columns: [table.replacementRevisionId],
      foreignColumns: [simulationScenarioApprovalRevisions.id],
    }).onDelete("restrict"),
    revisionSequenceUnique: uniqueIndex(
      "sim_scenario_approval_events_revision_sequence_unique",
    ).on(table.approvalRevisionId, table.eventSequence),
    replacementIdx: index("sim_scenario_approval_events_replacement_idx").on(
      table.replacementRevisionId,
    ),
    sequenceCheck: check(
      "sim_scenario_approval_events_sequence_check",
      sql`${table.eventSequence} in (1, 2)`,
    ),
    auditVersionCheck: check(
      "sim_scenario_approval_events_audit_version_check",
      sql`${table.auditVersion} = 'scenario_vector_approval_audit_v1'`,
    ),
    transitionShapeCheck: check(
      "sim_scenario_approval_events_transition_shape_check",
      sql`(${table.eventSequence} = 1 and ${table.transitionKind} = 'explicit_approval' and ${table.previousStatus} is null and ${table.resultingStatus} = 'approved' and ${table.replacementRevisionId} is null) or (${table.eventSequence} = 2 and ${table.transitionKind} = 'revocation' and ${table.previousStatus} = 'approved' and ${table.resultingStatus} = 'revoked' and ${table.replacementRevisionId} is null) or (${table.eventSequence} = 2 and ${table.transitionKind} = 'supersession' and ${table.previousStatus} = 'approved' and ${table.resultingStatus} = 'superseded' and ${table.replacementRevisionId} is not null and ${table.replacementRevisionId} <> ${table.approvalRevisionId})`,
    ),
  }),
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    name: varchar("name", { length: 255 }).notNull(),
    ticker: varchar("ticker", { length: 50 }),
    assetType: varchar("asset_type", { length: 50 }).default("etf"),
    category: varchar("category", { length: 100 }),

    market: varchar("market", { length: 20 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    account: varchar("account", { length: 50 }).notNull(),
    accountId: uuid("account_id"),

    quantity: decimal("quantity", { precision: 20, scale: 6 }).notNull(),
    currentPrice: decimal("current_price", { precision: 20, scale: 4 }).notNull(),
    priceSource: varchar("price_source", { length: 100 }),
    priceFetchedAt: timestamp("price_fetched_at", { withTimezone: true }),
    priceAsOf: timestamp("price_as_of", { withTimezone: true }),
    priceQuoteType: varchar("price_quote_type", { length: 50 }),
    priceStatus: varchar("price_status", { length: 50 }),
    priceError: text("price_error"),
    averageCost: decimal("average_cost", { precision: 20, scale: 4 }),
    targetWeight: decimal("target_weight", { precision: 8, scale: 4 }),

    groupId: uuid("group_id"),
    memo: text("memo"),
    description: text("description"),

    maAssetClass: varchar("ma_asset_class", { length: 50 }),
    maRuleEnabled: boolean("ma_rule_enabled").default(true),
    ma120: decimal("ma_120", { precision: 20, scale: 4 }),
    daysAboveMa: integer("days_above_ma").default(0),
    fractionalKrwValue: decimal("fractional_krw_value", {
      precision: 20,
      scale: 4,
    }),
    fractionalAvgCost: decimal("fractional_avg_cost", {
      precision: 20,
      scale: 4,
    }),
    monthlyContribution: decimal("monthly_contribution", {
      precision: 20,
      scale: 4,
    }),
    contributionDay: integer("contribution_day"),

    createdById: varchar("created_by_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex("assets_legacy_base44_id_unique").on(
      table.legacyBase44Id,
    ),
    canonicalOwnerUserIdIdx: index(
      "assets_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ownerUserId: varchar("owner_user_id", { length: 255 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    accountType: varchar("account_type", { length: 50 }).notNull(),
    currency: varchar("currency", { length: 10 }).default("KRW").notNull(),

    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerCodeUnique: uniqueIndex("accounts_owner_code_unique").on(
      table.ownerUserId,
      table.code,
    ),
    canonicalOwnerUserIdIdx: index(
      "accounts_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const assetGroups = pgTable(
  "asset_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    ownerUserId: varchar("owner_user_id", { length: 255 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),
    name: varchar("name", { length: 100 }).notNull(),
    targetWeight: decimal("target_weight", { precision: 8, scale: 4 }),

    description: text("description"),
    color: varchar("color", { length: 20 }),

    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),

    fxExempt: boolean("fx_exempt").default(false).notNull(),
    maExempt: boolean("ma_exempt").default(false).notNull(),
    executionMode: varchar("execution_mode", { length: 50 })
      .default("gap_first")
      .notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "asset_groups_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    ownerNameUnique: uniqueIndex("asset_groups_owner_name_unique").on(
      table.ownerUserId,
      table.name,
    ),
    canonicalOwnerUserIdIdx: index(
      "asset_groups_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const assetGroupMembers = pgTable(
  "asset_group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ownerUserId: varchar("owner_user_id", { length: 255 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),
    groupId: uuid("group_id").notNull(),
    assetId: uuid("asset_id").notNull(),

    priority: integer("priority"),
    allocationRatio: decimal("allocation_ratio", { precision: 8, scale: 4 }),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    groupAssetUnique: uniqueIndex("asset_group_members_group_asset_unique").on(
      table.groupId,
      table.assetId,
    ),
    canonicalOwnerUserIdIdx: index(
      "asset_group_members_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    rateDate: date("date").notNull(),
    usdKrw: decimal("usdkrw", { precision: 20, scale: 6 }).notNull(),
    source: varchar("source", { length: 100 }),
    status: varchar("status", { length: 50 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    isSample: boolean("is_sample").default(false).notNull(),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex("fx_rates_legacy_base44_id_unique").on(
      table.legacyBase44Id,
    ),
    rateDateIdx: index("fx_rates_date_idx").on(table.rateDate),
  }),
);

export const assetPriceSnapshots = pgTable(
  "asset_price_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    priceDate: date("date").notNull(),
    ticker: varchar("ticker", { length: 50 }).notNull(),
    assetId: uuid("asset_id"),
    market: varchar("market", { length: 20 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    closePrice: decimal("close_price", { precision: 28, scale: 12 }).notNull(),
    adjustedClosePrice: decimal("adjusted_close_price", {
      precision: 28,
      scale: 12,
    }),
    adjustedCloseBasis: varchar("adjusted_close_basis", { length: 50 }),
    adjustedCloseProvider: varchar("adjusted_close_provider", { length: 50 }),
    adjustedCloseSource: varchar("adjusted_close_source", { length: 100 }),
    adjustedCloseFetchedAt: timestamp("adjusted_close_fetched_at", {
      withTimezone: true,
    }),
    closePriceKrw: decimal("close_price_krw", { precision: 28, scale: 12 }),
    fxRate: decimal("fx_rate", { precision: 20, scale: 6 }),
    source: varchar("source", { length: 100 }),
    providerSymbol: varchar("provider_symbol", { length: 100 }),
    providerExchange: varchar("provider_exchange", { length: 50 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    isSample: boolean("is_sample").default(false).notNull(),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "asset_price_snapshots_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    tickerDateUnique: uniqueIndex("asset_price_snapshots_ticker_date_unique").on(
      table.ticker,
      table.priceDate,
    ),
    instrumentDateUnique: uniqueIndex(
      "asset_price_snapshots_instrument_date_unique",
    ).on(table.market, table.currency, table.ticker, table.priceDate),
    priceDateIdx: index("asset_price_snapshots_date_idx").on(table.priceDate),
    assetDateIdx: index("asset_price_snapshots_asset_date_idx").on(
      table.assetId,
      table.priceDate,
    ),
  }),
);

export const marketDataSyncRuns = pgTable(
  "market_data_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    jobType: varchar("job_type", { length: 100 }).notNull(),
    mode: varchar("mode", { length: 50 }),
    status: varchar("status", { length: 50 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    source: varchar("source", { length: 100 }),

    requestedCount: integer("requested_count"),
    successCount: integer("success_count"),
    failedCount: integer("failed_count"),
    skippedCount: integer("skipped_count"),

    metadataJson: jsonb("metadata_json"),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    jobStartedIdx: index("market_data_sync_runs_job_started_idx").on(
      table.jobType,
      table.startedAt,
    ),
    statusStartedIdx: index("market_data_sync_runs_status_started_idx").on(
      table.status,
      table.startedAt,
    ),
  }),
);

export const livePriceQuotes = pgTable(
  "live_price_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ticker: varchar("ticker", { length: 50 }).notNull(),
    market: varchar("market", { length: 20 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    source: varchar("source", { length: 100 }).notNull(),
    quoteType: varchar("quote_type", { length: 50 }).notNull(),
    status: varchar("status", { length: 50 }).notNull(),
    error: text("error"),

    price: decimal("price", { precision: 28, scale: 12 }).notNull(),
    priceAsOf: timestamp("price_as_of", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    quoteIdentityUnique: uniqueIndex(
      "live_price_quotes_market_ticker_provider_unique",
    ).on(table.market, table.ticker, table.provider),
    tickerIdx: index("live_price_quotes_ticker_idx").on(table.ticker),
    fetchedAtIdx: index("live_price_quotes_fetched_at_idx").on(table.fetchedAt),
  }),
);

export const benchmarkSnapshots = pgTable(
  "benchmark_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    benchmarkDate: date("date").notNull(),
    benchmarkTicker: varchar("benchmark_ticker", { length: 50 }).notNull(),
    benchmarkName: varchar("benchmark_name", { length: 255 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    closePrice: decimal("close_price", { precision: 28, scale: 12 }).notNull(),
    normalizedIndexValue: decimal("normalized_index_value", {
      precision: 28,
      scale: 12,
    }).notNull(),
    fxRate: decimal("fx_rate", { precision: 20, scale: 6 }),
    source: varchar("source", { length: 100 }),
    isSample: boolean("is_sample").default(false).notNull(),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "benchmark_snapshots_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    tickerDateIdx: index("benchmark_snapshots_ticker_date_idx").on(
      table.benchmarkTicker,
      table.benchmarkDate,
    ),
    benchmarkDateIdx: index("benchmark_snapshots_date_idx").on(
      table.benchmarkDate,
    ),
  }),
);

export const etfMasters = pgTable(
  "etf_masters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    ticker: varchar("ticker", { length: 50 }).notNull(),
    name: text("name").notNull(),
    market: varchar("market", { length: 20 }).notNull(),
    exchange: varchar("exchange", { length: 100 }),
    currency: varchar("currency", { length: 10 }).notNull(),
    issuer: text("issuer"),
    isin: varchar("isin", { length: 50 }),
    assetClass: varchar("asset_class", { length: 100 }),
    categoryLabel: text("category_label"),
    benchmarkName: text("benchmark_name"),
    overlapGroup: varchar("overlap_group", { length: 150 }),
    riskLevel: varchar("risk_level", { length: 50 }),
    regionFocus: varchar("region_focus", { length: 100 }),
    currencyExposure: varchar("currency_exposure", { length: 50 }),
    distributionFrequency: varchar("distribution_frequency", { length: 50 }),
    etfStrategy: varchar("etf_strategy", { length: 100 }),
    listingCountry: varchar("listing_country", { length: 10 }),
    leverageType: varchar("leverage_type", { length: 50 }),
    dataSource: text("data_source"),
    officialUrl: text("official_url"),
    notes: text("notes"),

    isActive: boolean("is_active").default(true).notNull(),
    isUniversePick: boolean("is_universe_pick"),
    isCurrencyHedged: boolean("is_currency_hedged").default(false).notNull(),
    isInverse: boolean("is_inverse").default(false).notNull(),
    isLeveraged: boolean("is_leveraged").default(false).notNull(),
    isSample: boolean("is_sample").default(false).notNull(),

    constituentCount: integer("constituent_count"),
    universePriority: integer("universe_priority"),
    aum: decimal("aum", { precision: 28, scale: 6 }),
    averageVolume: decimal("average_volume", { precision: 28, scale: 6 }),
    expenseRatio: decimal("expense_ratio", { precision: 20, scale: 8 }),
    dividendYield: decimal("dividend_yield", { precision: 20, scale: 8 }),
    costScore: decimal("cost_score", { precision: 20, scale: 6 }),
    liquidityScore: decimal("liquidity_score", { precision: 20, scale: 6 }),
    leverageFactor: decimal("leverage_factor", { precision: 20, scale: 6 }),
    rateSensitivity: decimal("rate_sensitivity", { precision: 20, scale: 6 }),

    accountSuitabilityJson: jsonb("account_suitability_json"),
    currencyExposureJson: jsonb("currency_exposure_json"),
    regionExposureJson: jsonb("region_exposure_json"),
    sectorExposureJson: jsonb("sector_exposure_json"),
    regionTagsJson: jsonb("region_tags_json"),
    sectorTagsJson: jsonb("sector_tags_json"),
    styleTagsJson: jsonb("style_tags_json"),
    themeTagsJson: jsonb("theme_tags_json"),
    substitutesJson: jsonb("substitutes_json"),
    top10HoldingsJson: jsonb("top10_holdings_json"),

    inceptionDate: date("inception_date"),
    exposureAsOfDate: date("exposure_as_of_date"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex("etf_masters_legacy_base44_id_unique").on(
      table.legacyBase44Id,
    ),
    tickerMarketUnique: uniqueIndex("etf_masters_ticker_market_unique").on(
      table.ticker,
      table.market,
    ),
    tickerIdx: index("etf_masters_ticker_idx").on(table.ticker),
    activeIdx: index("etf_masters_is_active_idx").on(table.isActive),
  }),
);

export const etfHoldings = pgTable(
  "etf_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    etfMasterId: uuid("etf_master_id"),
    legacyEtfId: varchar("legacy_etf_id", { length: 24 }),
    etfTicker: varchar("etf_ticker", { length: 50 }).notNull(),
    etfName: text("etf_name").notNull(),
    asOfDate: date("as_of_date").notNull(),

    holdingSymbol: varchar("holding_symbol", { length: 100 }),
    holdingName: text("holding_name").notNull(),
    holdingMarket: varchar("holding_market", { length: 20 }),
    holdingCountry: varchar("holding_country", { length: 10 }),
    currency: varchar("currency", { length: 10 }),
    sector: varchar("sector", { length: 100 }),
    industry: varchar("industry", { length: 150 }),
    securityType: varchar("security_type", { length: 50 }),
    source: varchar("source", { length: 100 }),
    sourceUrl: text("source_url"),
    notes: text("notes"),
    isTop10: boolean("is_top10").default(false).notNull(),
    isSample: boolean("is_sample").default(false).notNull(),

    rank: integer("rank"),
    weightPct: decimal("weight_pct", { precision: 20, scale: 8 }),
    shares: decimal("shares", { precision: 28, scale: 8 }),
    marketValue: decimal("market_value", { precision: 28, scale: 8 }),

    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex("etf_holdings_legacy_base44_id_unique").on(
      table.legacyBase44Id,
    ),
    etfTickerDateIdx: index("etf_holdings_ticker_date_idx").on(
      table.etfTicker,
      table.asOfDate,
    ),
    legacyEtfDateIdx: index("etf_holdings_legacy_etf_date_idx").on(
      table.legacyEtfId,
      table.asOfDate,
    ),
    etfMasterDateIdx: index("etf_holdings_master_date_idx").on(
      table.etfMasterId,
      table.asOfDate,
    ),
    holdingSymbolIdx: index("etf_holdings_holding_symbol_idx").on(
      table.holdingSymbol,
    ),
  }),
);

export const eventLedgerEntries = pgTable(
  "event_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    eventDate: date("event_date").notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    source: varchar("source", { length: 100 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    ruleVersion: varchar("rule_version", { length: 100 }),

    account: varchar("account", { length: 50 }),
    accountId: uuid("account_id"),

    assetId: uuid("asset_id"),
    legacyAssetId: varchar("legacy_asset_id", { length: 24 }).notNull(),
    ticker: varchar("ticker", { length: 50 }),
    assetName: text("asset_name").notNull(),

    groupId: uuid("group_id"),
    legacyGroupId: varchar("legacy_group_id", { length: 24 }),
    groupName: text("group_name"),

    correctsEventId: uuid("corrects_event_id"),
    legacyCorrectsEventId: varchar("legacy_corrects_event_id", { length: 24 }),

    amountKrw: decimal("amount_krw", { precision: 28, scale: 8 }),
    quantityDelta: decimal("quantity_delta", { precision: 28, scale: 8 }),
    price: decimal("price", { precision: 28, scale: 12 }),
    fxRate: decimal("fx_rate", { precision: 20, scale: 6 }),

    beforeValue: text("before_value").notNull(),
    afterValue: text("after_value").notNull(),
    memo: text("memo"),
    description: text("description"),
    isSample: boolean("is_sample").default(false).notNull(),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "event_ledger_entries_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    eventDateTypeIdx: index("event_ledger_entries_date_type_idx").on(
      table.eventDate,
      table.eventType,
    ),
    legacyAssetIdIdx: index("event_ledger_entries_legacy_asset_id_idx").on(
      table.legacyAssetId,
    ),
    assetDateIdx: index("event_ledger_entries_asset_date_idx").on(
      table.assetId,
      table.eventDate,
    ),
    accountDateIdx: index("event_ledger_entries_account_date_idx").on(
      table.account,
      table.eventDate,
    ),
    legacyGroupIdIdx: index("event_ledger_entries_legacy_group_id_idx").on(
      table.legacyGroupId,
    ),
    canonicalOwnerUserIdIdx: index(
      "event_ledger_entries_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const marketRegimeDaily = pgTable(
  "market_regime_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    regimeDate: date("date").notNull(),
    account: varchar("account", { length: 50 }).notNull(),
    accountId: uuid("account_id"),
    label: varchar("label", { length: 100 }).notNull(),
    description: text("description"),
    driversJson: jsonb("drivers_json").notNull(),
    isSample: boolean("is_sample").default(false).notNull(),

    macroStressScore: decimal("macro_stress_score", {
      precision: 20,
      scale: 6,
    }),
    regimeScore: decimal("regime_score", { precision: 20, scale: 6 }),
    newsSentimentScore: decimal("news_sentiment_score", {
      precision: 20,
      scale: 6,
    }),
    avgCorrelation: decimal("avg_correlation", { precision: 20, scale: 6 }),
    enb: decimal("enb", { precision: 20, scale: 6 }),
    portfolioVolatility: decimal("portfolio_volatility", {
      precision: 20,
      scale: 6,
    }),
    yieldCurve: decimal("yield_curve", { precision: 20, scale: 6 }),
    rateLevel: decimal("rate_level", { precision: 20, scale: 6 }),
    stressBadgeCount: integer("stress_badge_count"),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "market_regime_daily_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    dateAccountIdx: index("market_regime_daily_date_account_idx").on(
      table.regimeDate,
      table.account,
    ),
    accountDateIdx: index("market_regime_daily_account_date_idx").on(
      table.account,
      table.regimeDate,
    ),
    canonicalOwnerUserIdIdx: index(
      "market_regime_daily_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const globalMarketFactors = pgTable(
  "global_market_factors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    factorDate: date("date").notNull(),
    factorKey: varchar("factor_key", { length: 100 }).notNull(),
    factorFamily: varchar("factor_family", { length: 100 }).notNull(),
    factorName: text("factor_name").notNull(),
    frequency: varchar("frequency", { length: 50 }).notNull(),
    source: varchar("source", { length: 100 }).notNull(),
    sourceSeriesId: varchar("source_series_id", { length: 150 }).notNull(),
    benchmarkKey: varchar("benchmark_key", { length: 100 }),
    countryCode: varchar("country_code", { length: 10 }).notNull(),
    region: varchar("region", { length: 50 }).notNull(),
    relatedCurrency: varchar("related_currency", { length: 10 }).notNull(),
    tenor: varchar("tenor", { length: 50 }).notNull(),
    description: text("description"),
    derivedMetricsJson: jsonb("derived_metrics_json").notNull(),
    isPreliminary: boolean("is_preliminary").default(false).notNull(),
    isSample: boolean("is_sample").default(false).notNull(),

    value: decimal("value", { precision: 28, scale: 12 }).notNull(),
    prevValue: decimal("prev_value", { precision: 28, scale: 12 }).notNull(),
    changePct: decimal("change_pct", { precision: 20, scale: 8 }),
    change1mPct: decimal("change_1m_pct", { precision: 20, scale: 8 }),
    change3mPct: decimal("change_3m_pct", { precision: 20, scale: 8 }),
    change6mPct: decimal("change_6m_pct", { precision: 20, scale: 8 }),
    changeSpeed20d: decimal("change_speed_20d", {
      precision: 20,
      scale: 8,
    }),
    percentile1y: decimal("percentile_1y", {
      precision: 20,
      scale: 8,
    }).notNull(),
    volatility20dPct: decimal("volatility_20d_pct", {
      precision: 20,
      scale: 8,
    }).notNull(),
    volatility60dPct: decimal("volatility_60d_pct", {
      precision: 20,
      scale: 8,
    }).notNull(),
    carrySpreadValue: decimal("carry_spread_value", {
      precision: 28,
      scale: 12,
    }),

    periodEndDate: date("period_end_date").notNull(),
    releaseDate: date("release_date").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "global_market_factors_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    factorDateIdx: index("global_market_factors_factor_date_idx").on(
      table.factorKey,
      table.factorDate,
    ),
    dateIdx: index("global_market_factors_date_idx").on(table.factorDate),
    familyDateIdx: index("global_market_factors_family_date_idx").on(
      table.factorFamily,
      table.factorDate,
    ),
  }),
);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    ownerUserId: varchar("owner_user_id", { length: 255 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    title: text("title"),
    category: varchar("category", { length: 100 }).notNull(),
    targetDate: date("target_date").notNull(),
    priority: integer("priority"),
    memo: text("memo"),
    isSample: boolean("is_sample").default(false).notNull(),

    targetAmount: decimal("target_amount", { precision: 28, scale: 6 }).notNull(),
    currentAllocatedAmount: decimal("current_allocated_amount", {
      precision: 28,
      scale: 6,
    }),
    monthlyContribution: decimal("monthly_contribution", {
      precision: 28,
      scale: 6,
    }),
    expectedReturn: decimal("expected_return", { precision: 20, scale: 8 }),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex("goals_legacy_base44_id_unique").on(
      table.legacyBase44Id,
    ),
    ownerTargetDateIdx: index("goals_owner_target_date_idx").on(
      table.ownerUserId,
      table.targetDate,
    ),
    canonicalOwnerUserIdIdx: index(
      "goals_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    ownerUserId: varchar("owner_user_id", { length: 255 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    transactionDate: date("date").notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    description: text("description"),
    memo: text("memo"),
    account: varchar("account", { length: 50 }),
    accountId: uuid("account_id"),
    paymentMethod: varchar("payment_method", { length: 50 }),
    isFixed: boolean("is_fixed").default(false).notNull(),
    isSample: boolean("is_sample").default(false).notNull(),

    amount: decimal("amount", { precision: 28, scale: 6 }).notNull(),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex("transactions_legacy_base44_id_unique").on(
      table.legacyBase44Id,
    ),
    ownerDateIdx: index("transactions_owner_date_idx").on(
      table.ownerUserId,
      table.transactionDate,
    ),
    typeDateIdx: index("transactions_type_date_idx").on(
      table.type,
      table.transactionDate,
    ),
    accountDateIdx: index("transactions_account_date_idx").on(
      table.account,
      table.transactionDate,
    ),
    canonicalOwnerUserIdIdx: index(
      "transactions_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const fixedTransactions = pgTable(
  "fixed_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    ownerUserId: varchar("owner_user_id", { length: 255 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    name: text("name").notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    dayOfMonth: integer("day_of_month").notNull(),
    holidayShift: varchar("holiday_shift", { length: 50 }),
    isActive: boolean("is_active").default(true).notNull(),
    isSample: boolean("is_sample").default(false).notNull(),

    amount: decimal("amount", { precision: 28, scale: 6 }).notNull(),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "fixed_transactions_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    ownerActiveIdx: index("fixed_transactions_owner_active_idx").on(
      table.ownerUserId,
      table.isActive,
    ),
    dayOfMonthIdx: index("fixed_transactions_day_of_month_idx").on(
      table.dayOfMonth,
    ),
    canonicalOwnerUserIdIdx: index(
      "fixed_transactions_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const monthlyIncomes = pgTable(
  "monthly_incomes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    ownerUserId: varchar("owner_user_id", { length: 255 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    year: integer("year").notNull(),
    month: integer("month").notNull(),
    payDay: integer("pay_day").notNull(),
    isSample: boolean("is_sample").default(false).notNull(),

    amount: decimal("amount", { precision: 28, scale: 6 }).notNull(),
    actualAmount: decimal("actual_amount", { precision: 28, scale: 6 }),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "monthly_incomes_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    ownerYearMonthUnique: uniqueIndex("monthly_incomes_owner_year_month_unique").on(
      table.ownerUserId,
      table.year,
      table.month,
    ),
    canonicalOwnerUserIdIdx: index(
      "monthly_incomes_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const accountBalanceSnapshots = pgTable(
  "account_balance_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    balanceDate: date("date").notNull(),
    cash: decimal("cash", { precision: 24, scale: 6 }),
    brokerage: decimal("brokerage", { precision: 24, scale: 6 }),
    isa: decimal("isa", { precision: 24, scale: 6 }),
    irp: decimal("irp", { precision: 24, scale: 6 }),
    isSample: boolean("is_sample").default(false).notNull(),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "account_balance_snapshots_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    balanceDateIdx: index("account_balance_snapshots_date_idx").on(
      table.balanceDate,
    ),
    canonicalOwnerUserIdIdx: index(
      "account_balance_snapshots_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const dailyPortfolioSnapshots = pgTable(
  "daily_portfolio_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    snapshotDate: date("snapshot_date").notNull(),
    account: varchar("account", { length: 50 }).notNull(),
    accountId: uuid("account_id"),
    source: varchar("source", { length: 100 }).default("base44_import").notNull(),
    ruleVersion: varchar("rule_version", { length: 100 }),
    description: text("description"),
    isSample: boolean("is_sample").default(false).notNull(),

    cashValue: decimal("cash_value", { precision: 24, scale: 6 }),
    investedAmount: decimal("invested_amount", { precision: 24, scale: 6 }),
    totalCost: decimal("total_cost", { precision: 24, scale: 6 }),
    totalMarketValue: decimal("total_market_value", {
      precision: 24,
      scale: 6,
    }),
    totalPnl: decimal("total_pnl", { precision: 24, scale: 6 }),
    totalReturnPct: decimal("total_return_pct", { precision: 20, scale: 6 }),
    fxRate: decimal("fx_rate", { precision: 20, scale: 6 }),
    usdKrw: decimal("usdkrw", { precision: 20, scale: 6 }),
    krWeight: decimal("kr_weight", { precision: 20, scale: 6 }),
    usWeight: decimal("us_weight", { precision: 20, scale: 6 }),
    usdExposurePct: decimal("usd_exposure_pct", { precision: 20, scale: 6 }),
    thematicWeight: decimal("thematic_weight", { precision: 20, scale: 6 }),
    numAssets: integer("num_assets"),
    numGroups: integer("num_groups"),
    topHoldingName: varchar("top_holding_name", { length: 255 }),
    topHoldingWeight: decimal("top_holding_weight", { precision: 20, scale: 6 }),

    benchmarkValue: decimal("benchmark_value", { precision: 24, scale: 6 }),
    benchmarkIndexValue: decimal("benchmark_index_value", {
      precision: 24,
      scale: 6,
    }),
    kodex200Value: decimal("kodex200_value", { precision: 24, scale: 6 }),
    kospi200Value: decimal("kospi200_value", { precision: 24, scale: 6 }),
    kospi200Index: decimal("kospi200_index", { precision: 24, scale: 6 }),
    sp500Index: decimal("sp500_index", { precision: 24, scale: 6 }),
    vooValue: decimal("voo_value", { precision: 24, scale: 6 }),

    avgCorrelation: decimal("avg_correlation", { precision: 20, scale: 6 }),
    enb: decimal("enb", { precision: 20, scale: 6 }),
    portfolioVolatility: decimal("portfolio_volatility", {
      precision: 20,
      scale: 6,
    }),
    regimeLabel: varchar("regime_label", { length: 100 }),
    regimeScore: decimal("regime_score", { precision: 20, scale: 6 }),

    capturedAt: timestamp("captured_at", { withTimezone: true }),
    cycleStartAt: timestamp("cycle_start_at", { withTimezone: true }),
    cycleEndAt: timestamp("cycle_end_at", { withTimezone: true }),
    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "daily_portfolio_snapshots_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    snapshotAccountIdx: index("daily_portfolio_snapshots_date_account_idx").on(
      table.snapshotDate,
      table.account,
    ),
    snapshotAccountSourceUnique: uniqueIndex(
      "daily_portfolio_snapshots_date_account_source_unique",
    ).on(table.snapshotDate, table.account, table.source),
    canonicalOwnerUserIdIdx: index(
      "daily_portfolio_snapshots_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const dailyPositionSnapshots = pgTable(
  "daily_position_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    snapshotDate: date("snapshot_date").notNull(),
    assetId: uuid("asset_id"),
    legacyAssetId: varchar("legacy_asset_id", { length: 24 }).notNull(),
    ticker: varchar("ticker", { length: 50 }),
    assetName: varchar("asset_name", { length: 255 }).notNull(),
    account: varchar("account", { length: 50 }).notNull(),
    accountId: uuid("account_id"),
    source: varchar("source", { length: 100 }).default("base44_import").notNull(),
    market: varchar("market", { length: 20 }),
    currency: varchar("currency", { length: 10 }),
    assetStatus: varchar("asset_status", { length: 50 }),
    assetType: varchar("asset_type", { length: 50 }),
    category: varchar("category", { length: 100 }),
    sector: varchar("sector", { length: 100 }),
    sourceType: varchar("source_type", { length: 50 }),
    exposureType: varchar("exposure_type", { length: 50 }),
    legacyGroupId: varchar("legacy_group_id", { length: 24 }),
    groupName: varchar("group_name", { length: 100 }),
    priceSource: varchar("price_source", { length: 100 }),
    priceBasis: varchar("price_basis", { length: 100 }),
    description: text("description"),
    belowMa: boolean("below_ma").default(false).notNull(),
    isSample: boolean("is_sample").default(false).notNull(),

    quantity: decimal("quantity", { precision: 24, scale: 8 }),
    totalQuantity: decimal("total_quantity", { precision: 24, scale: 8 }),
    estimatedFractionalQuantity: decimal("estimated_fractional_quantity", {
      precision: 24,
      scale: 8,
    }),
    avgCost: decimal("avg_cost", { precision: 24, scale: 6 }),
    currentPrice: decimal("current_price", { precision: 24, scale: 6 }),
    closePrice: decimal("close_price", { precision: 24, scale: 6 }),
    unitPrice: decimal("unit_price", { precision: 24, scale: 6 }),
    unitValueKrw: decimal("unit_value_krw", { precision: 24, scale: 6 }),
    marketValueLocal: decimal("market_value_local", {
      precision: 24,
      scale: 6,
    }),
    marketValueKrw: decimal("market_value_krw", { precision: 24, scale: 6 }),
    costKrw: decimal("cost_krw", { precision: 24, scale: 6 }),
    pnlKrw: decimal("pnl_krw", { precision: 24, scale: 6 }),
    pnlPct: decimal("pnl_pct", { precision: 20, scale: 6 }),
    currentWeight: decimal("current_weight", { precision: 20, scale: 6 }),
    targetWeight: decimal("target_weight", { precision: 20, scale: 6 }),
    targetWeightRaw: decimal("target_weight_raw", { precision: 20, scale: 6 }),
    targetWeightEffective: decimal("target_weight_effective", {
      precision: 20,
      scale: 6,
    }),
    trimTargetWeight: decimal("trim_target_weight", { precision: 20, scale: 6 }),
    driftPct: decimal("drift_pct", { precision: 20, scale: 6 }),
    fxRate: decimal("fx_rate", { precision: 20, scale: 6 }),
    previousFxRate: decimal("previous_fx_rate", { precision: 20, scale: 6 }),
    previousQuantity: decimal("previous_quantity", { precision: 24, scale: 8 }),
    previousUnitPrice: decimal("previous_unit_price", {
      precision: 24,
      scale: 6,
    }),
    previousUnitValueKrw: decimal("previous_unit_value_krw", {
      precision: 24,
      scale: 6,
    }),
    previousMarketValueKrw: decimal("previous_market_value_krw", {
      precision: 24,
      scale: 6,
    }),
    priceChangeKrw: decimal("price_change_krw", { precision: 24, scale: 6 }),
    fxChangeKrw: decimal("fx_change_krw", { precision: 24, scale: 6 }),
    marketValueChangeKrw: decimal("market_value_change_krw", {
      precision: 24,
      scale: 6,
    }),
    marketValueChangePct: decimal("market_value_change_pct", {
      precision: 20,
      scale: 6,
    }),
    unitValueChangeKrw: decimal("unit_value_change_krw", {
      precision: 24,
      scale: 6,
    }),
    unitValueChangePct: decimal("unit_value_change_pct", {
      precision: 20,
      scale: 6,
    }),
    ma120: decimal("ma_120", { precision: 24, scale: 6 }),
    fractionalKrwValue: decimal("fractional_krw_value", {
      precision: 24,
      scale: 6,
    }),
    fractionalAvgCost: decimal("fractional_avg_cost", {
      precision: 24,
      scale: 6,
    }),

    priceDate: date("price_date"),
    referenceDate: date("reference_date"),
    fxReferenceDate: date("fx_reference_date"),
    previousReferenceDate: date("previous_reference_date"),
    previousSnapshotDate: date("previous_snapshot_date"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    cycleStartAt: timestamp("cycle_start_at", { withTimezone: true }),
    cycleEndAt: timestamp("cycle_end_at", { withTimezone: true }),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex(
      "daily_position_snapshots_legacy_base44_id_unique",
    ).on(table.legacyBase44Id),
    snapshotDateIdx: index("daily_position_snapshots_date_idx").on(
      table.snapshotDate,
    ),
    legacyAssetIdIdx: index("daily_position_snapshots_legacy_asset_id_idx").on(
      table.legacyAssetId,
    ),
    snapshotAccountAssetSourceUnique: uniqueIndex(
      "daily_position_snapshots_date_account_asset_source_unique",
    )
      .on(table.snapshotDate, table.account, table.assetId, table.source)
      .where(sql`${table.assetId} is not null`),
    canonicalOwnerUserIdIdx: index(
      "daily_position_snapshots_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export const settings = pgTable(
  "settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),
    canonicalOwnerUserId: uuid("canonical_owner_user_id"),

    annualIncomeGrowth: decimal("annual_income_growth", {
      precision: 20,
      scale: 6,
    }),
    housingGoal: decimal("housing_goal", { precision: 24, scale: 6 }),
    housingGoalDate: date("housing_goal_date"),
    housingContractSigned: boolean("housing_contract_signed")
      .default(false)
      .notNull(),
    incomeCashPct: decimal("income_cash_pct", { precision: 20, scale: 6 }),
    incomeIsaPct: decimal("income_isa_pct", { precision: 20, scale: 6 }),
    incomeSecuritiesPct: decimal("income_securities_pct", {
      precision: 20,
      scale: 6,
    }),
    isaContributedThisYear: decimal("isa_contributed_this_year", {
      precision: 24,
      scale: 6,
    }),
    isaYearlyLimit: decimal("isa_yearly_limit", { precision: 24, scale: 6 }),
    minExecutionRatioPct: decimal("min_execution_ratio_pct", {
      precision: 20,
      scale: 6,
    }),
    postGoalCashCap: decimal("post_goal_cash_cap", { precision: 24, scale: 6 }),
    postGoalCashRatio: decimal("post_goal_cash_ratio", {
      precision: 20,
      scale: 6,
    }),
    postGoalEtfRatio: decimal("post_goal_etf_ratio", {
      precision: 20,
      scale: 6,
    }),
    preGoalCashCap: decimal("pre_goal_cash_cap", { precision: 24, scale: 6 }),
    preGoalCashRatio: decimal("pre_goal_cash_ratio", {
      precision: 20,
      scale: 6,
    }),
    preGoalEtfRatio: decimal("pre_goal_etf_ratio", {
      precision: 20,
      scale: 6,
    }),
    trimDriftThreshold: decimal("trim_drift_threshold", {
      precision: 20,
      scale: 6,
    }),
    usdKrwRate: decimal("usd_krw_rate", { precision: 20, scale: 6 }),
    useTrendFilter: boolean("use_trend_filter").default(false).notNull(),
    isSample: boolean("is_sample").default(false).notNull(),
    description: text("description"),

    base44CreatedAt: timestamp("base44_created_at", { withTimezone: true }),
    base44UpdatedAt: timestamp("base44_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyBase44IdUnique: uniqueIndex("settings_legacy_base44_id_unique").on(
      table.legacyBase44Id,
    ),
    canonicalOwnerUserIdIdx: index(
      "settings_canonical_owner_user_id_idx",
    ).on(table.canonicalOwnerUserId),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type AppUser = typeof appUsers.$inferSelect;
export type NewAppUser = typeof appUsers.$inferInsert;

export type AuthIdentity = typeof authIdentities.$inferSelect;
export type NewAuthIdentity = typeof authIdentities.$inferInsert;

export type SimulationScenarioApprovalRevision =
  typeof simulationScenarioApprovalRevisions.$inferSelect;
export type NewSimulationScenarioApprovalRevision =
  typeof simulationScenarioApprovalRevisions.$inferInsert;

export type SimulationScenarioApprovalVectorRow =
  typeof simulationScenarioApprovalVectorRows.$inferSelect;
export type NewSimulationScenarioApprovalVectorRow =
  typeof simulationScenarioApprovalVectorRows.$inferInsert;

export type SimulationScenarioApprovalLifecycleEvent =
  typeof simulationScenarioApprovalLifecycleEvents.$inferSelect;
export type NewSimulationScenarioApprovalLifecycleEvent =
  typeof simulationScenarioApprovalLifecycleEvents.$inferInsert;

export type AssetGroup = typeof assetGroups.$inferSelect;
export type NewAssetGroup = typeof assetGroups.$inferInsert;

export type AssetGroupMember = typeof assetGroupMembers.$inferSelect;
export type NewAssetGroupMember = typeof assetGroupMembers.$inferInsert;

export type FxRate = typeof fxRates.$inferSelect;
export type NewFxRate = typeof fxRates.$inferInsert;

export type AssetPriceSnapshot = typeof assetPriceSnapshots.$inferSelect;
export type NewAssetPriceSnapshot = typeof assetPriceSnapshots.$inferInsert;

export type MarketDataSyncRun = typeof marketDataSyncRuns.$inferSelect;
export type NewMarketDataSyncRun = typeof marketDataSyncRuns.$inferInsert;

export type BenchmarkSnapshot = typeof benchmarkSnapshots.$inferSelect;
export type NewBenchmarkSnapshot = typeof benchmarkSnapshots.$inferInsert;

export type EtfMaster = typeof etfMasters.$inferSelect;
export type NewEtfMaster = typeof etfMasters.$inferInsert;

export type EtfHolding = typeof etfHoldings.$inferSelect;
export type NewEtfHolding = typeof etfHoldings.$inferInsert;

export type EventLedgerEntry = typeof eventLedgerEntries.$inferSelect;
export type NewEventLedgerEntry = typeof eventLedgerEntries.$inferInsert;

export type MarketRegimeDaily = typeof marketRegimeDaily.$inferSelect;
export type NewMarketRegimeDaily = typeof marketRegimeDaily.$inferInsert;

export type GlobalMarketFactor = typeof globalMarketFactors.$inferSelect;
export type NewGlobalMarketFactor = typeof globalMarketFactors.$inferInsert;

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type FixedTransaction = typeof fixedTransactions.$inferSelect;
export type NewFixedTransaction = typeof fixedTransactions.$inferInsert;

export type MonthlyIncome = typeof monthlyIncomes.$inferSelect;
export type NewMonthlyIncome = typeof monthlyIncomes.$inferInsert;

export type AccountBalanceSnapshot = typeof accountBalanceSnapshots.$inferSelect;
export type NewAccountBalanceSnapshot =
  typeof accountBalanceSnapshots.$inferInsert;

export type DailyPortfolioSnapshot = typeof dailyPortfolioSnapshots.$inferSelect;
export type NewDailyPortfolioSnapshot =
  typeof dailyPortfolioSnapshots.$inferInsert;

export type DailyPositionSnapshot = typeof dailyPositionSnapshots.$inferSelect;
export type NewDailyPositionSnapshot = typeof dailyPositionSnapshots.$inferInsert;

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
