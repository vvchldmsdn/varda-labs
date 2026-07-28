import {
  LegacyAccountOwnerAssignmentError,
} from "./legacy-account-owner-assignment-writer.mjs";
import {
  OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT,
  assignOwnerAssignmentFixture,
  assertAllOwnerAssignmentAccountsOwnedBy,
  createOwnerAssignmentPartialUpdateTrigger,
  dropOwnerAssignmentPartialUpdateObjects,
  expectOwnerAssignmentError,
  isOwnerAssignmentError,
  ownerAssignmentFixtureError,
  readOwnerAssignmentAccounts,
  setAllOwnerAssignmentCanonicalOwners,
  withOwnerAssignmentFixture,
} from "./legacy-account-owner-assignment-rehearsal-fixture.mjs";
import {
  LegacyAccountOwnerAssignmentRehearsalFixtureError,
} from "./legacy-account-owner-assignment-rehearsal-evidence.mjs";

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_REHEARSAL_CASES =
  Object.freeze([
    Object.freeze({
      stage: "successful_assignment",
      run: rehearseSuccessfulAssignment,
    }),
    Object.freeze({
      stage: "already_applied",
      run: rehearseAlreadyApplied,
    }),
    Object.freeze({
      stage: "missing_consumed_evidence",
      run: rehearseMissingConsumedEvidence,
    }),
    Object.freeze({
      stage: "digest_drift",
      run: rehearseDigestDrift,
    }),
    Object.freeze({
      stage: "foreign_owner",
      run: rehearseForeignOwner,
    }),
    Object.freeze({
      stage: "same_target_race",
      run: rehearseSameTargetRace,
    }),
    Object.freeze({
      stage: "partial_update_rollback",
      run: rehearsePartialUpdateRollback,
    }),
    Object.freeze({
      stage: "lock_timeout_rollback",
      run: rehearseLockTimeoutRollback,
    }),
  ]);

async function rehearseSuccessfulAssignment(pool, baselineAccounts) {
  await withOwnerAssignmentFixture(
    pool,
    baselineAccounts,
    {},
    async (fixture) => {
      const result = await assignOwnerAssignmentFixture(pool, fixture);
      if (
        result.result !== "assigned" ||
        result.actualWrites.accounts !==
          OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT
      ) {
        throw ownerAssignmentFixtureError(
          "synthetic_case_post_state_invalid",
        );
      }
      await assertAllOwnerAssignmentAccountsOwnedBy(
        pool,
        fixture.targetAppUserId,
      );
    },
  );
}

async function rehearseAlreadyApplied(pool, baselineAccounts) {
  await withOwnerAssignmentFixture(
    pool,
    baselineAccounts,
    {},
    async (fixture) => {
      await setAllOwnerAssignmentCanonicalOwners(
        pool,
        fixture.targetAppUserId,
      );
      const result = await assignOwnerAssignmentFixture(pool, fixture);
      if (
        result.result !== "already_applied" ||
        result.actualWrites.accounts !== 0
      ) {
        throw ownerAssignmentFixtureError(
          "synthetic_case_post_state_invalid",
        );
      }
      await assertAllOwnerAssignmentAccountsOwnedBy(
        pool,
        fixture.targetAppUserId,
      );
    },
  );
}

async function rehearseMissingConsumedEvidence(
  pool,
  baselineAccounts,
) {
  await withOwnerAssignmentFixture(
    pool,
    baselineAccounts,
    { includeConsumedEvent: false },
    async (fixture) => {
      await expectOwnerAssignmentError(
        () => assignOwnerAssignmentFixture(pool, fixture),
        "consumed_event_not_found",
      );
      await assertAllOwnerAssignmentAccountsOwnedBy(pool, null);
    },
  );
}

async function rehearseDigestDrift(pool, baselineAccounts) {
  await withOwnerAssignmentFixture(
    pool,
    baselineAccounts,
    {},
    async (fixture) => {
      await expectOwnerAssignmentError(
        () =>
          assignOwnerAssignmentFixture(pool, {
            ...fixture,
            eligibleSetDigest: `sha256:${"0".repeat(64)}`,
          }),
        "account_evidence_digest_drift",
      );
      await assertAllOwnerAssignmentAccountsOwnedBy(pool, null);
    },
  );
}

async function rehearseForeignOwner(pool, baselineAccounts) {
  await withOwnerAssignmentFixture(
    pool,
    baselineAccounts,
    { includeForeignOwner: true },
    async (fixture) => {
      await pool.query(
        `
          update accounts
          set canonical_owner_user_id = $1::uuid,
              updated_at = clock_timestamp()
          where id = $2::uuid
        `,
        [fixture.foreignOwnerAppUserId, fixture.accountIds[0]],
      );
      await expectOwnerAssignmentError(
        () => assignOwnerAssignmentFixture(pool, fixture),
        "foreign_owner_conflict",
      );
      const rows = await readOwnerAssignmentAccounts(pool);
      if (
        rows.filter(
          ({ canonical_owner_user_id }) =>
            canonical_owner_user_id ===
            fixture.foreignOwnerAppUserId,
        ).length !== 1 ||
        rows.filter(
          ({ canonical_owner_user_id }) =>
            canonical_owner_user_id === null,
        ).length !==
          OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT - 1
      ) {
        throw ownerAssignmentFixtureError(
          "synthetic_case_post_state_invalid",
        );
      }
    },
  );
}

async function rehearseSameTargetRace(pool, baselineAccounts) {
  await withOwnerAssignmentFixture(
    pool,
    baselineAccounts,
    {},
    async (fixture) => {
      const attempts = await Promise.allSettled([
        assignOwnerAssignmentFixture(pool, fixture),
        assignOwnerAssignmentFixture(pool, fixture),
      ]);
      const assignedCount = attempts.filter(
        (attempt) =>
          attempt.status === "fulfilled" &&
          attempt.value.result === "assigned",
      ).length;
      const acceptableSecondCount = attempts.filter(
        (attempt) =>
          (attempt.status === "fulfilled" &&
            attempt.value.result === "already_applied") ||
          (attempt.status === "rejected" &&
            isOwnerAssignmentError(
              attempt.reason,
              "database_timeout",
            )),
      ).length;
      if (assignedCount !== 1 || acceptableSecondCount !== 1) {
        throw ownerAssignmentFixtureError("race_outcome_invalid");
      }
      await assertAllOwnerAssignmentAccountsOwnedBy(
        pool,
        fixture.targetAppUserId,
      );
    },
  );
}

async function rehearsePartialUpdateRollback(
  pool,
  baselineAccounts,
) {
  await withOwnerAssignmentFixture(
    pool,
    baselineAccounts,
    {},
    async (fixture) => {
      await createOwnerAssignmentPartialUpdateTrigger(
        pool,
        fixture.accountIds[0],
      );
      try {
        await expectOwnerAssignmentError(
          () => assignOwnerAssignmentFixture(pool, fixture),
          "account_update_count_mismatch",
        );
        await assertAllOwnerAssignmentAccountsOwnedBy(pool, null);
      } finally {
        await dropOwnerAssignmentPartialUpdateObjects(pool);
      }
    },
  );
}

async function rehearseLockTimeoutRollback(
  pool,
  baselineAccounts,
) {
  await withOwnerAssignmentFixture(
    pool,
    baselineAccounts,
    {},
    async (fixture) => {
      const blocker = await pool.connect();
      let transactionOpen = false;
      try {
        await blocker.query("begin");
        transactionOpen = true;
        const locked = await blocker.query(`
          select id
          from accounts
          order by id
          for update
        `);
        if (
          locked.rowCount !==
          OWNER_ASSIGNMENT_REHEARSAL_ACCOUNT_COUNT
        ) {
          throw ownerAssignmentFixtureError(
            "lock_timeout_fixture_failed",
          );
        }
        await expectOwnerAssignmentError(
          () => assignOwnerAssignmentFixture(pool, fixture),
          "database_timeout",
        );
      } catch (error) {
        if (
          error instanceof LegacyAccountOwnerAssignmentError ||
          error instanceof
            LegacyAccountOwnerAssignmentRehearsalFixtureError
        ) {
          throw error;
        }
        throw ownerAssignmentFixtureError(
          "lock_timeout_fixture_failed",
        );
      } finally {
        if (transactionOpen) {
          await blocker.query("rollback");
        }
        blocker.release();
      }
      await assertAllOwnerAssignmentAccountsOwnedBy(pool, null);
    },
  );
}
