export type WriterClassification =
  | "user_owned"
  | "shared_reference"
  | "admin_system"
  | "mixed";

export type WriterAuthorization = "migration_cli" | "machine_admin";

export type WriterOperation = "insert" | "update" | "delete";

export type OwnerWritePolicy = "trusted_context_required" | "owner_forbidden";

export type WriterTarget = Readonly<{
  table: string;
  classification: Exclude<WriterClassification, "mixed">;
  operations: readonly WriterOperation[];
  ownerPolicy: OwnerWritePolicy;
}>;

export type WriterTransitionPolicy = Readonly<{
  prepare:
    | "shadow_trusted_context"
    | "split_target_classes"
    | "owner_not_applicable";
  activate:
    | "dual_write_user_targets"
    | "owner_aware_repository_or_freeze"
    | "owner_scoped_delete"
    | "keep_owner_absent";
  freeze:
    | "freeze_without_verified_owner"
    | "freeze_user_targets_only"
    | "freeze_until_owner_scoped_delete"
    | "not_required";
}>;

export type TenantWriterDefinition = Readonly<{
  id: string;
  classification: WriterClassification;
  authorization: WriterAuthorization;
  entrypoints: readonly string[];
  implementationPaths: readonly string[];
  targets: readonly WriterTarget[];
  transition: WriterTransitionPolicy;
  canonicalOwnerHttpInput: "forbidden";
  legacyOwnerEvidence: "separate" | "not_applicable";
}>;

const USER_IMPORT_TRANSITION = {
  prepare: "shadow_trusted_context",
  activate: "dual_write_user_targets",
  freeze: "freeze_without_verified_owner",
} as const;

const USER_API_TRANSITION = {
  prepare: "shadow_trusted_context",
  activate: "owner_aware_repository_or_freeze",
  freeze: "freeze_without_verified_owner",
} as const;

const SHARED_TRANSITION = {
  prepare: "owner_not_applicable",
  activate: "keep_owner_absent",
  freeze: "not_required",
} as const;

const MIXED_TRANSITION = {
  prepare: "split_target_classes",
  activate: "dual_write_user_targets",
  freeze: "freeze_user_targets_only",
} as const;

export const TENANT_WRITER_REGISTRY = [
  {
    id: "base44_core_import",
    classification: "user_owned",
    authorization: "migration_cli",
    entrypoints: ["scripts/import-base44-core.mjs"],
    implementationPaths: ["scripts/import-base44-core.mjs"],
    targets: [
      userTarget("accounts", "insert", "update"),
      userTarget("asset_groups", "insert", "update"),
      userTarget("assets", "insert", "update"),
      userTarget("asset_group_members", "insert", "update"),
    ],
    transition: USER_IMPORT_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "base44_history_import",
    classification: "mixed",
    authorization: "migration_cli",
    entrypoints: ["scripts/import-base44-history.mjs"],
    implementationPaths: ["scripts/import-base44-history.mjs"],
    targets: [
      sharedTarget("fx_rates", "insert", "update"),
      userTarget("account_balance_snapshots", "insert", "update"),
      userTarget("daily_portfolio_snapshots", "insert", "update"),
      userTarget("daily_position_snapshots", "insert", "update"),
    ],
    transition: MIXED_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "base44_settings_import",
    classification: "user_owned",
    authorization: "migration_cli",
    entrypoints: ["scripts/import-base44-settings.mjs"],
    implementationPaths: ["scripts/import-base44-settings.mjs"],
    targets: [userTarget("settings", "insert", "update")],
    transition: USER_IMPORT_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "base44_market_data_import",
    classification: "shared_reference",
    authorization: "migration_cli",
    entrypoints: ["scripts/import-base44-market-data.mjs"],
    implementationPaths: ["scripts/import-base44-market-data.mjs"],
    targets: [
      sharedTarget("asset_price_snapshots", "insert", "update"),
      sharedTarget("benchmark_snapshots", "insert", "update"),
    ],
    transition: SHARED_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "not_applicable",
  },
  {
    id: "base44_etf_reference_import",
    classification: "shared_reference",
    authorization: "migration_cli",
    entrypoints: ["scripts/import-base44-etf-reference.mjs"],
    implementationPaths: ["scripts/import-base44-etf-reference.mjs"],
    targets: [
      sharedTarget("etf_masters", "insert", "update"),
      sharedTarget("etf_holdings", "insert", "update"),
    ],
    transition: SHARED_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "not_applicable",
  },
  {
    id: "base44_event_import",
    classification: "user_owned",
    authorization: "migration_cli",
    entrypoints: ["scripts/import-base44-events.mjs"],
    implementationPaths: ["scripts/import-base44-events.mjs"],
    targets: [userTarget("event_ledger_entries", "insert", "update")],
    transition: USER_IMPORT_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "base44_market_context_import",
    classification: "mixed",
    authorization: "migration_cli",
    entrypoints: ["scripts/import-base44-market-context.mjs"],
    implementationPaths: ["scripts/import-base44-market-context.mjs"],
    targets: [
      userTarget("market_regime_daily", "insert", "update"),
      sharedTarget("global_market_factors", "insert", "update"),
    ],
    transition: MIXED_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "base44_cashflow_goal_import",
    classification: "user_owned",
    authorization: "migration_cli",
    entrypoints: ["scripts/import-base44-cashflow-goals.mjs"],
    implementationPaths: ["scripts/import-base44-cashflow-goals.mjs"],
    targets: [
      userTarget("goals", "insert", "update"),
      userTarget("transactions", "insert", "update"),
      userTarget("fixed_transactions", "insert", "update"),
      userTarget("monthly_incomes", "insert", "update"),
    ],
    transition: USER_IMPORT_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "base44_nonportfolio_asset_cleanup",
    classification: "user_owned",
    authorization: "migration_cli",
    entrypoints: ["scripts/remove-base44-nonportfolio-assets.mjs"],
    implementationPaths: ["scripts/remove-base44-nonportfolio-assets.mjs"],
    targets: [userTarget("assets", "delete")],
    transition: {
      prepare: "shadow_trusted_context",
      activate: "owner_scoped_delete",
      freeze: "freeze_until_owner_scoped_delete",
    },
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "entity_accounts_api",
    classification: "user_owned",
    authorization: "machine_admin",
    entrypoints: ["/api/entities/accounts", "/api/entities/accounts/[id]"],
    implementationPaths: [
      "src/app/api/entities/accounts/route.ts",
      "src/app/api/entities/accounts/[id]/route.ts",
    ],
    targets: [userTarget("accounts", "insert", "update", "delete")],
    transition: USER_API_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "entity_assets_api",
    classification: "user_owned",
    authorization: "machine_admin",
    entrypoints: ["/api/entities/assets", "/api/entities/assets/[id]"],
    implementationPaths: [
      "src/app/api/entities/assets/route.ts",
      "src/app/api/entities/assets/[id]/route.ts",
    ],
    targets: [userTarget("assets", "insert", "update", "delete")],
    transition: USER_API_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "entity_asset_groups_api",
    classification: "user_owned",
    authorization: "machine_admin",
    entrypoints: ["/api/entities/asset-groups", "/api/entities/asset-groups/[id]"],
    implementationPaths: [
      "src/app/api/entities/asset-groups/route.ts",
      "src/app/api/entities/asset-groups/[id]/route.ts",
    ],
    targets: [userTarget("asset_groups", "insert", "update", "delete")],
    transition: USER_API_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "entity_asset_group_members_api",
    classification: "user_owned",
    authorization: "machine_admin",
    entrypoints: [
      "/api/entities/asset-group-members",
      "/api/entities/asset-group-members/[id]",
    ],
    implementationPaths: [
      "src/app/api/entities/asset-group-members/route.ts",
      "src/app/api/entities/asset-group-members/[id]/route.ts",
    ],
    targets: [
      userTarget("asset_group_members", "insert", "update", "delete"),
    ],
    transition: USER_API_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "separate",
  },
  {
    id: "admin_market_price_sync",
    classification: "mixed",
    authorization: "machine_admin",
    entrypoints: ["/api/admin/market/prices/sync"],
    implementationPaths: ["src/lib/market-data/price-sync.ts"],
    targets: [
      adminTarget("market_data_sync_runs", "insert", "update"),
      sharedTarget("live_price_quotes", "insert", "update"),
      sharedTarget("asset_price_snapshots", "insert", "update"),
    ],
    transition: {
      prepare: "split_target_classes",
      activate: "keep_owner_absent",
      freeze: "not_required",
    },
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "not_applicable",
  },
  {
    id: "admin_fx_sync",
    classification: "shared_reference",
    authorization: "machine_admin",
    entrypoints: ["/api/admin/market/fx/sync"],
    implementationPaths: ["src/app/api/admin/market/fx/sync/route.ts"],
    targets: [sharedTarget("fx_rates", "insert", "update")],
    transition: SHARED_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "not_applicable",
  },
  {
    id: "admin_daily_snapshot",
    classification: "user_owned",
    authorization: "machine_admin",
    entrypoints: ["/api/admin/snapshots/daily"],
    implementationPaths: ["src/lib/snapshots/daily.ts"],
    targets: [
      userTarget("daily_portfolio_snapshots", "insert", "update"),
      userTarget("daily_position_snapshots", "insert", "update"),
    ],
    transition: USER_API_TRANSITION,
    canonicalOwnerHttpInput: "forbidden",
    legacyOwnerEvidence: "not_applicable",
  },
] as const satisfies readonly TenantWriterDefinition[];

function userTarget(
  table: string,
  ...operations: readonly WriterOperation[]
): WriterTarget {
  return {
    table,
    classification: "user_owned",
    operations,
    ownerPolicy: "trusted_context_required",
  };
}

function sharedTarget(
  table: string,
  ...operations: readonly WriterOperation[]
): WriterTarget {
  return {
    table,
    classification: "shared_reference",
    operations,
    ownerPolicy: "owner_forbidden",
  };
}

function adminTarget(
  table: string,
  ...operations: readonly WriterOperation[]
): WriterTarget {
  return {
    table,
    classification: "admin_system",
    operations,
    ownerPolicy: "owner_forbidden",
  };
}
