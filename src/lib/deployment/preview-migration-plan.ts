const MIGRATION_HASH_PATTERN = /^[0-9a-f]{64}$/;

export type LocalMigrationEvidence = {
  tag: string;
  createdAt: number;
  sha256: string;
};

export type AppliedMigrationEvidence = {
  createdAt: number;
  sha256: string;
};

export type PreviewMigrationPlan = {
  status: "ready";
  appliedCount: number;
  localCount: number;
  latestAppliedTag: string | null;
  pendingTags: string[];
};

export function planPreviewMigrations(input: {
  localMigrations: readonly LocalMigrationEvidence[];
  appliedMigrations: readonly AppliedMigrationEvidence[];
  allowedPendingMigrations: readonly LocalMigrationEvidence[];
}): PreviewMigrationPlan {
  const local = validateLocalMigrations(input.localMigrations);
  const applied = validateAppliedMigrations(input.appliedMigrations);
  const allowed = validateLocalMigrations(input.allowedPendingMigrations);

  if (applied.length > local.length) {
    throw new Error("Database migration ledger is ahead of the local journal.");
  }

  for (let index = 0; index < applied.length; index += 1) {
    const expected = local[index];
    const actual = applied[index];
    if (
      actual.createdAt !== expected.createdAt ||
      actual.sha256 !== expected.sha256
    ) {
      throw new Error(
        `Database migration ledger diverges at local migration ${expected.tag}.`,
      );
    }
  }

  const allowedByTag = new Map(
    allowed.map((migration) => [migration.tag, migration]),
  );
  const pending = local.slice(applied.length);
  for (const migration of pending) {
    const approval = allowedByTag.get(migration.tag);
    if (
      !approval ||
      approval.createdAt !== migration.createdAt ||
      approval.sha256 !== migration.sha256
    ) {
      throw new Error(
        `Pending Preview migration is not allowlisted: ${migration.tag}.`,
      );
    }
  }

  return {
    status: "ready",
    appliedCount: applied.length,
    localCount: local.length,
    latestAppliedTag:
      applied.length === 0 ? null : local[applied.length - 1].tag,
    pendingTags: pending.map(({ tag }) => tag),
  };
}

function validateLocalMigrations(
  migrations: readonly LocalMigrationEvidence[],
) {
  const normalized = migrations.map((migration) => ({
    tag: migration.tag,
    createdAt: migration.createdAt,
    sha256: migration.sha256,
  }));
  const tags = new Set<string>();
  const timestamps = new Set<number>();

  for (const migration of normalized) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(migration.tag)) {
      throw new Error("Local migration tag is invalid.");
    }
    if (!Number.isSafeInteger(migration.createdAt) || migration.createdAt <= 0) {
      throw new Error(`Local migration timestamp is invalid: ${migration.tag}.`);
    }
    if (!MIGRATION_HASH_PATTERN.test(migration.sha256)) {
      throw new Error(`Local migration hash is invalid: ${migration.tag}.`);
    }
    if (tags.has(migration.tag) || timestamps.has(migration.createdAt)) {
      throw new Error("Local migration evidence contains duplicate identity.");
    }
    tags.add(migration.tag);
    timestamps.add(migration.createdAt);
  }

  assertAscending(
    normalized.map(({ createdAt }) => createdAt),
    "Local migrations",
  );
  return normalized;
}

function validateAppliedMigrations(
  migrations: readonly AppliedMigrationEvidence[],
) {
  const normalized = migrations.map((migration) => ({
    createdAt: Number(migration.createdAt),
    sha256: migration.sha256,
  }));
  const timestamps = new Set<number>();

  for (const migration of normalized) {
    if (!Number.isSafeInteger(migration.createdAt) || migration.createdAt <= 0) {
      throw new Error("Applied migration timestamp is invalid.");
    }
    if (!MIGRATION_HASH_PATTERN.test(migration.sha256)) {
      throw new Error("Applied migration hash is invalid.");
    }
    if (timestamps.has(migration.createdAt)) {
      throw new Error("Applied migration ledger contains duplicate timestamp.");
    }
    timestamps.add(migration.createdAt);
  }

  assertAscending(
    normalized.map(({ createdAt }) => createdAt),
    "Applied migrations",
  );
  return normalized;
}

function assertAscending(values: number[], label: string) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      throw new Error(`${label} must be in strict journal order.`);
    }
  }
}
