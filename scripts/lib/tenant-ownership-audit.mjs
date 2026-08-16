import { TRANSITIONAL_OWNER_COLUMN } from "./tenant-ownership-policy.mjs";

const FINAL_OWNER_COLUMN = "owner_user_id";
const UUID_TYPE = "uuid";

export function buildTenantOwnershipAudit(input) {
  const rowCountByTable = new Map(
    input.rowCounts.map((row) => [row.table_name, Number(row.row_count)]),
  );
  const columnByKey = new Map(
    input.ownerColumns.map((column) => [
      `${column.table_name}:${column.column_name}`,
      column,
    ]),
  );
  const ownerStatsByKey = new Map(
    input.ownerStats.map((stats) => [
      `${stats.table_name}:${stats.column_name}`,
      stats,
    ]),
  );

  const directTables = input.policies.map((policy) =>
    buildDirectTable({
      policy,
      rows: rowCountByTable.get(policy.table) ?? 0,
      columnByKey,
      ownerStatsByKey,
    }),
  );
  const directByName = new Map(
    directTables.map((table) => [table.table, table]),
  );
  const tables = directTables.map((table) =>
    table.ownershipPath === "parent_fk"
      ? inheritParentOwnership(table, directByName)
      : table,
  );

  const productScopeTables = tables.filter(
    (table) =>
      table.classification === "user_owned" &&
      table.canonicalOwnerRolloutScope !== "intentionally_skipped_legacy",
  );
  const legacyExcludedTables = tables.filter(
    (table) =>
      table.canonicalOwnerRolloutScope === "intentionally_skipped_legacy",
  );
  const productScopeRows = sum(productScopeTables, (table) => table.rows);
  const effectiveOwnerReadyRows = sum(
    productScopeTables,
    (table) => table.effectiveOwnedRows,
  );
  const finalOwnerContractReadyRows = sum(
    productScopeTables.filter((table) => table.finalOwnerContractReady),
    (table) => table.rows,
  );

  return Object.freeze({
    tables: Object.freeze(tables),
    ownershipSummary: Object.freeze({
      productScopeTableCount: productScopeTables.length,
      productScopeRows,
      effectiveOwnerReadyRows,
      productScopeRowsWithoutEffectiveOwner:
        productScopeRows - effectiveOwnerReadyRows,
      finalOwnerContractReadyRows,
      transitionalOwnerReadyRows:
        effectiveOwnerReadyRows - finalOwnerContractReadyRows,
      legacyExcludedTableCount: legacyExcludedTables.length,
      legacyExcludedRows: sum(legacyExcludedTables, (table) => table.rows),
    }),
  });
}

export function collectAuditedOwnerColumns(policies, ownerColumns) {
  const available = new Set(
    ownerColumns.map(
      (column) => `${column.table_name}:${column.column_name}`,
    ),
  );
  const selected = new Map();

  for (const policy of policies) {
    if (policy.ownershipPath !== "direct_column") continue;
    for (const columnName of [
      policy.currentOwnerColumn,
      TRANSITIONAL_OWNER_COLUMN,
      FINAL_OWNER_COLUMN,
    ]) {
      if (!columnName) continue;
      const key = `${policy.table}:${columnName}`;
      if (available.has(key)) {
        selected.set(key, Object.freeze({ table: policy.table, columnName }));
      }
    }
  }

  return Object.freeze([...selected.values()]);
}

function buildDirectTable({ policy, rows, columnByKey, ownerStatsByKey }) {
  const base = {
    table: policy.table,
    classification: policy.classification,
    rows,
    canonicalOwnerRequired: policy.canonicalOwnerRequired,
    canonicalOwnerRolloutScope: policy.canonicalOwnerRolloutScope,
    ownershipPath: policy.ownershipPath,
    parentTable: policy.parentTable ?? null,
    ownerContractStatus: "not_applicable",
    finalOwnerContractReady: false,
    effectiveOwnerReady: true,
    effectiveOwnedRows: rows,
    finalOwner: null,
    transitionalOwner: null,
    legacyOwner: null,
  };

  if (policy.classification !== "user_owned") return Object.freeze(base);
  if (policy.ownershipPath === "parent_fk") {
    return Object.freeze({
      ...base,
      ownerContractStatus: "parent_pending",
      effectiveOwnerReady: false,
      effectiveOwnedRows: 0,
    });
  }

  const ownerUserColumn = describeOwner(
    policy.table,
    FINAL_OWNER_COLUMN,
    columnByKey,
    ownerStatsByKey,
  );
  const finalOwner = ownerUserColumn?.type === UUID_TYPE ? ownerUserColumn : null;
  const transitionalOwner = describeOwner(
    policy.table,
    TRANSITIONAL_OWNER_COLUMN,
    columnByKey,
    ownerStatsByKey,
  );
  const legacyOwner =
    policy.currentOwnerColumn &&
    policy.currentOwnerColumn !== TRANSITIONAL_OWNER_COLUMN &&
    !(
      policy.currentOwnerColumn === FINAL_OWNER_COLUMN &&
      ownerUserColumn?.type === UUID_TYPE
    )
      ? describeOwner(
          policy.table,
          policy.currentOwnerColumn,
          columnByKey,
          ownerStatsByKey,
        )
      : null;

  if (policy.canonicalOwnerRolloutScope === "intentionally_skipped_legacy") {
    return Object.freeze({
      ...base,
      ownerContractStatus: "intentionally_skipped_legacy",
      effectiveOwnerReady: false,
      effectiveOwnedRows: 0,
      finalOwner,
      transitionalOwner,
      legacyOwner,
    });
  }

  if (finalOwner) {
    const complete = finalOwner.nullRows === 0;
    const contractReady = complete && !finalOwner.nullable;
    return Object.freeze({
      ...base,
      ownerContractStatus: contractReady
        ? "final_contract"
        : complete
          ? "final_column_nullable_complete"
          : finalOwner.nonNullRows > 0
            ? "final_column_partial"
            : "final_column_missing_values",
      finalOwnerContractReady: contractReady,
      effectiveOwnerReady: complete,
      effectiveOwnedRows: finalOwner.nonNullRows,
      finalOwner,
      transitionalOwner,
      legacyOwner,
    });
  }

  if (transitionalOwner?.type === UUID_TYPE) {
    const complete = transitionalOwner.nullRows === 0;
    return Object.freeze({
      ...base,
      ownerContractStatus: complete
        ? "transitional_complete"
        : transitionalOwner.nonNullRows > 0
          ? "transitional_partial"
          : "transitional_missing_values",
      effectiveOwnerReady: complete,
      effectiveOwnedRows: transitionalOwner.nonNullRows,
      finalOwner,
      transitionalOwner,
      legacyOwner,
    });
  }

  return Object.freeze({
    ...base,
    ownerContractStatus: "owner_column_missing",
    effectiveOwnerReady: rows === 0,
    effectiveOwnedRows: 0,
    finalOwner,
    transitionalOwner,
    legacyOwner,
  });
}

function inheritParentOwnership(table, tableByName) {
  const parent = table.parentTable ? tableByName.get(table.parentTable) : null;
  const parentReady = parent?.effectiveOwnerReady === true;
  const parentFinal = parent?.finalOwnerContractReady === true;
  return Object.freeze({
    ...table,
    ownerContractStatus: parentFinal
      ? "parent_final_contract"
      : parentReady
        ? "parent_transitional_complete"
        : "parent_incomplete",
    finalOwnerContractReady: parentFinal,
    effectiveOwnerReady: parentReady,
    effectiveOwnedRows: parentReady ? table.rows : 0,
  });
}

function describeOwner(table, columnName, columnByKey, ownerStatsByKey) {
  const key = `${table}:${columnName}`;
  const column = columnByKey.get(key);
  const stats = ownerStatsByKey.get(key);
  if (!column) return null;
  if (!stats) throw new Error(`${key} owner stats are missing`);

  return Object.freeze({
    column: column.column_name,
    type: column.data_type,
    nullable: column.is_nullable === "YES",
    nullRows: Number(stats.null_rows),
    nonNullRows: Number(stats.non_null_rows),
    distinctValues: Number(stats.distinct_values),
  });
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + selector(row), 0);
}
