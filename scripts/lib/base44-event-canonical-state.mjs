export async function readBase44EventCanonicalState(
  sql,
  {
    canonicalOwnerId,
    legacyOwnerUserId,
    sourceEvents,
  },
) {
  const eventLegacyIds = uniqueStrings([
    ...sourceEvents.map(({ legacyBase44Id }) => legacyBase44Id),
    ...sourceEvents.map(({ legacyCorrectsEventId }) => legacyCorrectsEventId),
  ]);
  const accountCodes = uniqueStrings(
    sourceEvents.map(({ account }) => account),
  );
  const assetLegacyIds = uniqueStrings(
    sourceEvents.map(({ legacyAssetId }) => legacyAssetId),
  );
  const groupLegacyIds = uniqueStrings(
    sourceEvents.map(({ legacyGroupId }) => legacyGroupId),
  );
  const selectCount =
    1 +
    Number(eventLegacyIds.length > 0) +
    Number(accountCodes.length > 0) +
    Number(assetLegacyIds.length > 0) +
    Number(groupLegacyIds.length > 0);

  const [appUsers, eventRows, accountRows, assetRows, groupRows] =
    await Promise.all([
      sql.query(
        `select status, role from app_users where id = $1::uuid`,
        [canonicalOwnerId],
      ),
      eventLegacyIds.length === 0
        ? Promise.resolve([])
        : sql.query(
            `
              select
                id::text,
                legacy_base44_id,
                canonical_owner_user_id::text,
                account_id::text,
                asset_id::text,
                group_id::text,
                corrects_event_id::text
              from event_ledger_entries
              where legacy_base44_id = any($1::varchar[])
            `,
            [eventLegacyIds],
          ),
      accountCodes.length === 0
        ? Promise.resolve([])
        : sql.query(
            `
              select id::text, code, canonical_owner_user_id::text
              from accounts
              where owner_user_id = $1
                and code = any($2::text[])
            `,
            [legacyOwnerUserId, accountCodes],
          ),
      assetLegacyIds.length === 0
        ? Promise.resolve([])
        : sql.query(
            `
              select id::text, legacy_base44_id, canonical_owner_user_id::text
              from assets
              where legacy_base44_id = any($1::varchar[])
            `,
            [assetLegacyIds],
          ),
      groupLegacyIds.length === 0
        ? Promise.resolve([])
        : sql.query(
            `
              select id::text, legacy_base44_id, canonical_owner_user_id::text
              from asset_groups
              where legacy_base44_id = any($1::varchar[])
            `,
            [groupLegacyIds],
          ),
    ]);

  return Object.freeze({
    appUser:
      appUsers.length === 1
        ? Object.freeze({ status: appUsers[0].status, role: appUsers[0].role })
        : null,
    events: freezeRows(
      eventRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
        accountId: row.account_id ?? null,
        assetId: row.asset_id ?? null,
        groupId: row.group_id ?? null,
        correctsEventId: row.corrects_event_id ?? null,
      })),
    ),
    accounts: freezeRows(
      accountRows.map((row) => ({
        id: row.id,
        code: row.code,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
      })),
    ),
    assets: freezeRows(
      assetRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
      })),
    ),
    groups: freezeRows(
      groupRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
      })),
    ),
    selectCount,
    databaseSideEffects: false,
  });
}

function uniqueStrings(values) {
  return [
    ...new Set(
      values.filter(
        (value) => typeof value === "string" && value.length > 0,
      ),
    ),
  ];
}

function freezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}
