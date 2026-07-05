import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SENSITIVE_PATTERN =
  /(token|secret|password|api[_-]?key|created_by|user_id|owner_user_id)/i;
const UPSERT_BATCH_SIZE = 25;

const GOAL_FIELDS = new Set([
  "id",
  "title",
  "category",
  "targetDate",
  "targetAmount",
  "currentAllocatedAmount",
  "monthlyContribution",
  "expectedReturn",
  "priority",
  "memo",
  "is_sample",
  "created_date",
  "updated_date",
]);

const TRANSACTION_FIELDS = new Set([
  "id",
  "date",
  "type",
  "category",
  "amount",
  "description",
  "memo",
  "account",
  "payment_method",
  "is_fixed",
  "is_sample",
  "created_date",
  "updated_date",
]);

const FIXED_TRANSACTION_FIELDS = new Set([
  "id",
  "name",
  "type",
  "category",
  "amount",
  "day_of_month",
  "holiday_shift",
  "is_active",
  "is_sample",
  "created_date",
  "updated_date",
]);

const MONTHLY_INCOME_FIELDS = new Set([
  "id",
  "year",
  "month",
  "amount",
  "actual_amount",
  "pay_day",
  "is_sample",
  "created_date",
  "updated_date",
]);

async function runInBatches(items, handler) {
  for (let index = 0; index < items.length; index += UPSERT_BATCH_SIZE) {
    const batch = items.slice(index, index + UPSERT_BATCH_SIZE);
    await Promise.all(batch.map(handler));
  }
}

function parseArgs(argv) {
  const args = {
    dataDir:
      process.env.BASE44_MIGRATION_DATA_DIR ??
      path.resolve(process.cwd(), "..", "gyeol-fin", "migration-data"),
    write: false,
    ownerUserId: process.env.IMPORT_OWNER_USER_ID ?? "base44-import",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--write") {
      args.write = true;
      continue;
    }

    if (arg === "--data-dir") {
      args.dataDir = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (arg === "--owner-user-id") {
      args.ownerUserId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.ownerUserId.trim()) {
    throw new Error("--owner-user-id cannot be empty");
  }

  return args;
}

function assertNoSensitiveContent(value, sourceName, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSensitiveContent(item, sourceName, [...keyPath, String(index)]),
    );
    return;
  }

  if (typeof value === "string") {
    if (SENSITIVE_PATTERN.test(value)) {
      throw new Error(
        `${sourceName} contains blocked sensitive text at "${keyPath.join(".")}". ` +
          "Use a sanitized export before importing.",
      );
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = [...keyPath, key];
    if (SENSITIVE_PATTERN.test(key)) {
      throw new Error(
        `${sourceName} contains blocked key "${nextPath.join(".")}". ` +
          "Use a sanitized export before importing.",
      );
    }
    assertNoSensitiveContent(nestedValue, sourceName, nextPath);
  }
}

function assertAllowedKeys(record, allowedFields, sourceName) {
  const blockedKeys = Object.keys(record).filter((key) => !allowedFields.has(key));
  if (blockedKeys.length > 0) {
    throw new Error(
      `${sourceName} contains non-allowlisted keys: ${blockedKeys.join(", ")}`,
    );
  }
}

async function readJsonArray(filePath, sourceName, allowedFields) {
  const raw = await readFile(filePath, "utf8");
  if (SENSITIVE_PATTERN.test(raw)) {
    throw new Error(`${sourceName} contains blocked sensitive text`);
  }

  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceName} must be a JSON array`);
  }

  assertNoSensitiveContent(parsed, sourceName);
  parsed.forEach((record) => assertAllowedKeys(record, allowedFields, sourceName));

  return parsed;
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredString(value, fieldName) {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

function assertBase44Id(value, fieldName) {
  const normalized = requiredString(value, fieldName);
  if (!BASE44_ID_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be a 24-character hex Base44 id`);
  }
  return normalized;
}

function optionalDecimal(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  return String(value);
}

function requiredDecimal(value, fieldName) {
  const normalized = optionalDecimal(value, fieldName);
  if (normalized === null) throw new Error(`${fieldName} is required`);
  return normalized;
}

function optionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return numberValue;
}

function requiredInteger(value, fieldName) {
  const normalized = optionalInteger(value, fieldName);
  if (normalized === null) throw new Error(`${fieldName} is required`);
  return normalized;
}

function optionalBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
}

function validateDateString(value, fieldName, required = false) {
  const normalized = optionalString(value);
  if (!normalized) {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
  return normalized;
}

function optionalTimestamp(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid timestamp`);
  }
  return date;
}

function assertRange(value, min, max, fieldName) {
  if (value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
  return value;
}

function normalizeGoal(record, ownerUserId) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "Goal.id"),
    ownerUserId,
    title: optionalString(record.title),
    category: requiredString(record.category, "Goal.category"),
    targetDate: validateDateString(record.targetDate, "Goal.targetDate", true),
    priority: optionalInteger(record.priority, "Goal.priority"),
    memo: optionalString(record.memo),
    isSample: optionalBoolean(record.is_sample),
    targetAmount: requiredDecimal(record.targetAmount, "Goal.targetAmount"),
    currentAllocatedAmount: optionalDecimal(
      record.currentAllocatedAmount,
      "Goal.currentAllocatedAmount",
    ),
    monthlyContribution: optionalDecimal(
      record.monthlyContribution,
      "Goal.monthlyContribution",
    ),
    expectedReturn: optionalDecimal(record.expectedReturn, "Goal.expectedReturn"),
    base44CreatedAt: optionalTimestamp(record.created_date, "Goal.created_date"),
    base44UpdatedAt: optionalTimestamp(record.updated_date, "Goal.updated_date"),
  };
}

function normalizeTransaction(record, ownerUserId) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "Transaction.id"),
    ownerUserId,
    transactionDate: validateDateString(record.date, "Transaction.date", true),
    type: requiredString(record.type, "Transaction.type"),
    category: requiredString(record.category, "Transaction.category"),
    description: optionalString(record.description),
    memo: optionalString(record.memo),
    account: optionalString(record.account),
    paymentMethod: optionalString(record.payment_method),
    isFixed: optionalBoolean(record.is_fixed),
    isSample: optionalBoolean(record.is_sample),
    amount: requiredDecimal(record.amount, "Transaction.amount"),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "Transaction.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "Transaction.updated_date",
    ),
  };
}

function normalizeFixedTransaction(record, ownerUserId) {
  const dayOfMonth = assertRange(
    requiredInteger(record.day_of_month, "FixedTransaction.day_of_month"),
    1,
    31,
    "FixedTransaction.day_of_month",
  );

  return {
    legacyBase44Id: assertBase44Id(record.id, "FixedTransaction.id"),
    ownerUserId,
    name: requiredString(record.name, "FixedTransaction.name"),
    type: requiredString(record.type, "FixedTransaction.type"),
    category: requiredString(record.category, "FixedTransaction.category"),
    dayOfMonth,
    holidayShift: optionalString(record.holiday_shift),
    isActive: optionalBoolean(record.is_active, true),
    isSample: optionalBoolean(record.is_sample),
    amount: requiredDecimal(record.amount, "FixedTransaction.amount"),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "FixedTransaction.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "FixedTransaction.updated_date",
    ),
  };
}

function normalizeMonthlyIncome(record, ownerUserId) {
  const month = assertRange(
    requiredInteger(record.month, "MonthlyIncome.month"),
    1,
    12,
    "MonthlyIncome.month",
  );
  const payDay = assertRange(
    requiredInteger(record.pay_day, "MonthlyIncome.pay_day"),
    1,
    31,
    "MonthlyIncome.pay_day",
  );

  return {
    legacyBase44Id: assertBase44Id(record.id, "MonthlyIncome.id"),
    ownerUserId,
    year: requiredInteger(record.year, "MonthlyIncome.year"),
    month,
    payDay,
    isSample: optionalBoolean(record.is_sample),
    amount: requiredDecimal(record.amount, "MonthlyIncome.amount"),
    actualAmount: optionalDecimal(
      record.actual_amount,
      "MonthlyIncome.actual_amount",
    ),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "MonthlyIncome.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "MonthlyIncome.updated_date",
    ),
  };
}

function dateRange(rows, key) {
  const values = rows.map((row) => row[key]).filter(Boolean).sort();
  if (values.length === 0) return null;
  return { from: values[0], to: values[values.length - 1] };
}

function yearMonthRange(rows) {
  const values = rows
    .map((row) => `${row.year}-${String(row.month).padStart(2, "0")}`)
    .sort();
  if (values.length === 0) return null;
  return { from: values[0], to: values[values.length - 1] };
}

function distribution(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] ?? "(null)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function summarize({ goals, transactions, fixedTransactions, monthlyIncomes }) {
  return {
    goals: goals.length,
    transactions: transactions.length,
    fixedTransactions: fixedTransactions.length,
    monthlyIncomes: monthlyIncomes.length,
    goalTargetDateRange: dateRange(goals, "targetDate"),
    transactionDateRange: dateRange(transactions, "transactionDate"),
    monthlyIncomeYearMonthRange: yearMonthRange(monthlyIncomes),
    transactionTypes: distribution(transactions, "type"),
    transactionCategories: distribution(transactions, "category"),
    transactionAccounts: distribution(transactions, "account"),
    fixedTransactionTypes: distribution(fixedTransactions, "type"),
    fixedTransactionCategories: distribution(fixedTransactions, "category"),
    monthlyIncomeYears: distribution(monthlyIncomes, "year"),
    goalsMissingTitle: goals.filter((goal) => !goal.title).length,
    transactionsMissingAccount: transactions.filter((transaction) => !transaction.account)
      .length,
    monthlyIncomesMissingActualAmount: monthlyIncomes.filter(
      (monthlyIncome) => monthlyIncome.actualAmount === null,
    ).length,
  };
}

async function loadAccountMap(sql, ownerUserId) {
  const rows = await sql`
    select code, id
    from accounts
    where owner_user_id = ${ownerUserId}
  `;

  return new Map(rows.map((row) => [row.code, row.id]));
}

async function upsertGoals(sql, goals) {
  await runInBatches(goals, async (goal) => {
    await sql`
      insert into goals (
        legacy_base44_id,
        owner_user_id,
        title,
        category,
        target_date,
        priority,
        memo,
        is_sample,
        target_amount,
        current_allocated_amount,
        monthly_contribution,
        expected_return,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${goal.legacyBase44Id},
        ${goal.ownerUserId},
        ${goal.title},
        ${goal.category},
        ${goal.targetDate},
        ${goal.priority},
        ${goal.memo},
        ${goal.isSample},
        ${goal.targetAmount},
        ${goal.currentAllocatedAmount},
        ${goal.monthlyContribution},
        ${goal.expectedReturn},
        ${goal.base44CreatedAt},
        ${goal.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        owner_user_id = excluded.owner_user_id,
        title = excluded.title,
        category = excluded.category,
        target_date = excluded.target_date,
        priority = excluded.priority,
        memo = excluded.memo,
        is_sample = excluded.is_sample,
        target_amount = excluded.target_amount,
        current_allocated_amount = excluded.current_allocated_amount,
        monthly_contribution = excluded.monthly_contribution,
        expected_return = excluded.expected_return,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

async function upsertTransactions(sql, transactions, accountMap) {
  await runInBatches(transactions, async (transaction) => {
    const accountId = transaction.account
      ? (accountMap.get(transaction.account) ?? null)
      : null;

    await sql`
      insert into transactions (
        legacy_base44_id,
        owner_user_id,
        date,
        type,
        category,
        description,
        memo,
        account,
        account_id,
        payment_method,
        is_fixed,
        is_sample,
        amount,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${transaction.legacyBase44Id},
        ${transaction.ownerUserId},
        ${transaction.transactionDate},
        ${transaction.type},
        ${transaction.category},
        ${transaction.description},
        ${transaction.memo},
        ${transaction.account},
        ${accountId},
        ${transaction.paymentMethod},
        ${transaction.isFixed},
        ${transaction.isSample},
        ${transaction.amount},
        ${transaction.base44CreatedAt},
        ${transaction.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        owner_user_id = excluded.owner_user_id,
        date = excluded.date,
        type = excluded.type,
        category = excluded.category,
        description = excluded.description,
        memo = excluded.memo,
        account = excluded.account,
        account_id = excluded.account_id,
        payment_method = excluded.payment_method,
        is_fixed = excluded.is_fixed,
        is_sample = excluded.is_sample,
        amount = excluded.amount,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

async function upsertFixedTransactions(sql, fixedTransactions) {
  await runInBatches(fixedTransactions, async (transaction) => {
    await sql`
      insert into fixed_transactions (
        legacy_base44_id,
        owner_user_id,
        name,
        type,
        category,
        day_of_month,
        holiday_shift,
        is_active,
        is_sample,
        amount,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${transaction.legacyBase44Id},
        ${transaction.ownerUserId},
        ${transaction.name},
        ${transaction.type},
        ${transaction.category},
        ${transaction.dayOfMonth},
        ${transaction.holidayShift},
        ${transaction.isActive},
        ${transaction.isSample},
        ${transaction.amount},
        ${transaction.base44CreatedAt},
        ${transaction.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        owner_user_id = excluded.owner_user_id,
        name = excluded.name,
        type = excluded.type,
        category = excluded.category,
        day_of_month = excluded.day_of_month,
        holiday_shift = excluded.holiday_shift,
        is_active = excluded.is_active,
        is_sample = excluded.is_sample,
        amount = excluded.amount,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

async function upsertMonthlyIncomes(sql, monthlyIncomes) {
  await runInBatches(monthlyIncomes, async (income) => {
    await sql`
      insert into monthly_incomes (
        legacy_base44_id,
        owner_user_id,
        year,
        month,
        pay_day,
        is_sample,
        amount,
        actual_amount,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${income.legacyBase44Id},
        ${income.ownerUserId},
        ${income.year},
        ${income.month},
        ${income.payDay},
        ${income.isSample},
        ${income.amount},
        ${income.actualAmount},
        ${income.base44CreatedAt},
        ${income.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        owner_user_id = excluded.owner_user_id,
        year = excluded.year,
        month = excluded.month,
        pay_day = excluded.pay_day,
        is_sample = excluded.is_sample,
        amount = excluded.amount,
        actual_amount = excluded.actual_amount,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

function summarizeMatches(transactions, accountMap) {
  const rowsWithAccount = transactions.filter((transaction) => transaction.account);

  return {
    matchedTransactionAccountRows: rowsWithAccount.filter((transaction) =>
      accountMap.has(transaction.account),
    ).length,
    unmatchedTransactionAccountRows: rowsWithAccount.filter(
      (transaction) => !accountMap.has(transaction.account),
    ).length,
    missingTransactionAccountRows: transactions.length - rowsWithAccount.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = {
    goals: "base44-goals.export.json",
    transactions: "base44-transactions.export.json",
    fixedTransactions: "base44-fixed-transactions.export.json",
    monthlyIncomes: "base44-monthly-incomes.export.json",
  };

  const [
    goalRecords,
    transactionRecords,
    fixedTransactionRecords,
    monthlyIncomeRecords,
  ] = await Promise.all([
    readJsonArray(path.join(args.dataDir, files.goals), files.goals, GOAL_FIELDS),
    readJsonArray(
      path.join(args.dataDir, files.transactions),
      files.transactions,
      TRANSACTION_FIELDS,
    ),
    readJsonArray(
      path.join(args.dataDir, files.fixedTransactions),
      files.fixedTransactions,
      FIXED_TRANSACTION_FIELDS,
    ),
    readJsonArray(
      path.join(args.dataDir, files.monthlyIncomes),
      files.monthlyIncomes,
      MONTHLY_INCOME_FIELDS,
    ),
  ]);

  const goals = goalRecords.map((record) => normalizeGoal(record, args.ownerUserId));
  const transactions = transactionRecords.map((record) =>
    normalizeTransaction(record, args.ownerUserId),
  );
  const fixedTransactions = fixedTransactionRecords.map((record) =>
    normalizeFixedTransaction(record, args.ownerUserId),
  );
  const monthlyIncomes = monthlyIncomeRecords.map((record) =>
    normalizeMonthlyIncome(record, args.ownerUserId),
  );
  const summary = summarize({
    goals,
    transactions,
    fixedTransactions,
    monthlyIncomes,
  });

  console.log(
    JSON.stringify(
      {
        mode: args.write ? "write" : "dry-run",
        dataDir: args.dataDir,
        ownerUserId: args.ownerUserId,
        ...summary,
      },
      null,
      2,
    ),
  );

  if (!args.write) {
    console.log("Dry run only. Re-run with --write to import into DATABASE_URL.");
    return;
  }

  config({ path: path.resolve(process.cwd(), ".env.local") });

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  const accountMap = await loadAccountMap(sql, args.ownerUserId);

  await upsertGoals(sql, goals);
  await upsertTransactions(sql, transactions, accountMap);
  await upsertFixedTransactions(sql, fixedTransactions);
  await upsertMonthlyIncomes(sql, monthlyIncomes);

  console.log(
    JSON.stringify(
      {
        importedGoals: goals.length,
        importedTransactions: transactions.length,
        importedFixedTransactions: fixedTransactions.length,
        importedMonthlyIncomes: monthlyIncomes.length,
        ...summarizeMatches(transactions, accountMap),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
