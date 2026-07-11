export async function readBase44CoreCanonicalState(
  sql,
  {
    canonicalOwnerId,
    legacyOwnerUserId,
    accountCodes,
    groups,
    assets,
  },
) {
  const groupLegacyIds = groups.map(({ legacyBase44Id }) => legacyBase44Id);
  const assetLegacyIds = assets.map(({ legacyBase44Id }) => legacyBase44Id);
  const selectCount =
    2 +
    Number(groupLegacyIds.length > 0) +
    Number(assetLegacyIds.length > 0) +
    Number(groupLegacyIds.length > 0 && assetLegacyIds.length > 0);

  const [appUsers, accountRows, groupRows, assetRows, memberRows] =
    await Promise.all([
      sql.query(
        `select status, role from app_users where id = $1::uuid`,
        [canonicalOwnerId],
      ),
      sql.query(
        `
          select id::text, code, canonical_owner_user_id::text
          from accounts
          where owner_user_id = $1
            and code = any($2::text[])
        `,
        [legacyOwnerUserId, accountCodes],
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
      assetLegacyIds.length === 0
        ? Promise.resolve([])
        : sql.query(
            `
              select
                id::text,
                legacy_base44_id,
                account_id::text,
                group_id::text,
                canonical_owner_user_id::text
              from assets
              where legacy_base44_id = any($1::varchar[])
            `,
            [assetLegacyIds],
          ),
      groupLegacyIds.length === 0 || assetLegacyIds.length === 0
        ? Promise.resolve([])
        : sql.query(
            `
              select
                m.group_id::text,
                m.asset_id::text,
                m.canonical_owner_user_id::text,
                g.legacy_base44_id as group_legacy_base44_id,
                a.legacy_base44_id as asset_legacy_base44_id
              from asset_group_members m
              join asset_groups g on g.id = m.group_id
              join assets a on a.id = m.asset_id
              where g.legacy_base44_id = any($1::varchar[])
                and a.legacy_base44_id = any($2::varchar[])
            `,
            [groupLegacyIds, assetLegacyIds],
          ),
    ]);

  const accountByCode = new Map(accountRows.map((row) => [row.code, row]));
  const groupByLegacyId = new Map(
    groupRows.map((row) => [row.legacy_base44_id, row]),
  );
  const assetByLegacyId = new Map(
    assetRows.map((row) => [row.legacy_base44_id, row]),
  );
  const memberByPair = new Map(
    memberRows.map((row) => [
      pairKey(row.group_legacy_base44_id, row.asset_legacy_base44_id),
      row,
    ]),
  );
  const accountIndexByCode = new Map(
    accountCodes.map((code, index) => [code, index]),
  );
  const groupIndexByLegacyId = new Map(
    groups.map((group, index) => [group.legacyBase44Id, index]),
  );
  const assetIndexByLegacyId = new Map(
    assets.map((asset, index) => [asset.legacyBase44Id, index]),
  );

  const accountStates = accountCodes.map((code) =>
    ownershipState(accountByCode.get(code)),
  );
  const groupStates = groups.map((group) =>
    ownershipState(groupByLegacyId.get(group.legacyBase44Id)),
  );
  const assetStates = assets.map((asset) => {
    const row = assetByLegacyId.get(asset.legacyBase44Id);
    const accountRow = accountByCode.get(asset.account);
    const groupRow = asset.legacyGroupId
      ? groupByLegacyId.get(asset.legacyGroupId)
      : null;

    return Object.freeze({
      ...ownershipState(row),
      accountIndex: accountIndexByCode.get(asset.account) ?? -1,
      groupIndex: asset.legacyGroupId
        ? (groupIndexByLegacyId.get(asset.legacyGroupId) ?? -1)
        : null,
      accountReferenceMatches:
        row === undefined ||
        (accountRow !== undefined && row.account_id === accountRow.id),
      groupReferenceMatches:
        row === undefined ||
        (asset.legacyGroupId === null
          ? row.group_id === null
          : groupRow !== undefined && row.group_id === groupRow.id),
    });
  });

  const memberStates = assets
    .filter((asset) => asset.legacyGroupId !== null)
    .map((asset) => {
      const groupRow = groupByLegacyId.get(asset.legacyGroupId);
      const assetRow = assetByLegacyId.get(asset.legacyBase44Id);
      const row = memberByPair.get(
        pairKey(asset.legacyGroupId, asset.legacyBase44Id),
      );

      return Object.freeze({
        ...ownershipState(row),
        groupIndex: groupIndexByLegacyId.get(asset.legacyGroupId) ?? -1,
        assetIndex: assetIndexByLegacyId.get(asset.legacyBase44Id) ?? -1,
        groupReferenceMatches:
          row === undefined ||
          (groupRow !== undefined && row.group_id === groupRow.id),
        assetReferenceMatches:
          row === undefined ||
          (assetRow !== undefined && row.asset_id === assetRow.id),
      });
    });

  return Object.freeze({
    appUser:
      appUsers.length === 1
        ? Object.freeze({ status: appUsers[0].status, role: appUsers[0].role })
        : null,
    tables: Object.freeze({
      accounts: Object.freeze(accountStates),
      asset_groups: Object.freeze(groupStates),
      assets: Object.freeze(assetStates),
      asset_group_members: Object.freeze(memberStates),
    }),
    selectCount,
    databaseSideEffects: false,
  });
}

function ownershipState(row) {
  return Object.freeze({
    exists: row !== undefined,
    canonicalOwnerUserId: row?.canonical_owner_user_id ?? null,
  });
}

function pairKey(groupLegacyId, assetLegacyId) {
  return `${groupLegacyId}\u0000${assetLegacyId}`;
}
