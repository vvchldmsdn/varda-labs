import {
  boolean,
  date,
  decimal,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

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
  }),
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ownerUserId: varchar("owner_user_id", { length: 255 }),
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
  }),
);

export const assetGroups = pgTable(
  "asset_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    ownerUserId: varchar("owner_user_id", { length: 255 }),
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
  }),
);

export const assetGroupMembers = pgTable(
  "asset_group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ownerUserId: varchar("owner_user_id", { length: 255 }),
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

export const accountBalanceSnapshots = pgTable(
  "account_balance_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

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
  }),
);

export const dailyPortfolioSnapshots = pgTable(
  "daily_portfolio_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    snapshotDate: date("snapshot_date").notNull(),
    account: varchar("account", { length: 50 }).notNull(),
    accountId: uuid("account_id"),
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
  }),
);

export const dailyPositionSnapshots = pgTable(
  "daily_position_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBase44Id: varchar("legacy_base44_id", { length: 24 }),

    snapshotDate: date("snapshot_date").notNull(),
    assetId: uuid("asset_id"),
    legacyAssetId: varchar("legacy_asset_id", { length: 24 }).notNull(),
    ticker: varchar("ticker", { length: 50 }),
    assetName: varchar("asset_name", { length: 255 }).notNull(),
    account: varchar("account", { length: 50 }).notNull(),
    accountId: uuid("account_id"),
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
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type AssetGroup = typeof assetGroups.$inferSelect;
export type NewAssetGroup = typeof assetGroups.$inferInsert;

export type AssetGroupMember = typeof assetGroupMembers.$inferSelect;
export type NewAssetGroupMember = typeof assetGroupMembers.$inferInsert;

export type FxRate = typeof fxRates.$inferSelect;
export type NewFxRate = typeof fxRates.$inferInsert;

export type AccountBalanceSnapshot = typeof accountBalanceSnapshots.$inferSelect;
export type NewAccountBalanceSnapshot =
  typeof accountBalanceSnapshots.$inferInsert;

export type DailyPortfolioSnapshot = typeof dailyPortfolioSnapshots.$inferSelect;
export type NewDailyPortfolioSnapshot =
  typeof dailyPortfolioSnapshots.$inferInsert;

export type DailyPositionSnapshot = typeof dailyPositionSnapshots.$inferSelect;
export type NewDailyPositionSnapshot = typeof dailyPositionSnapshots.$inferInsert;
