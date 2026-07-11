export async function readBase44HistoryCanonicalState(
  sql,
  {
    canonicalOwnerId,
    legacyOwnerUserId,
    source,
  },
) {
  const balanceLegacyIds = uniqueStrings(
    source.balances.map(({ legacyBase44Id }) => legacyBase44Id),
  );
  const balanceDates = uniqueStrings(
    source.balances.map(({ balanceDate }) => balanceDate),
  );
  const portfolioLegacyIds = uniqueStrings(
    source.portfolios.map(({ legacyBase44Id }) => legacyBase44Id),
  );
  const portfolioDates = uniqueStrings(
    source.portfolios.map(({ snapshotDate }) => snapshotDate),
  );
  const portfolioAccounts = uniqueStrings(
    source.portfolios.map(({ account }) => account),
  );
  const positionLegacyIds = uniqueStrings(
    source.positions.map(({ legacyBase44Id }) => legacyBase44Id),
  );
  const positionDates = uniqueStrings(
    source.positions.map(({ snapshotDate }) => snapshotDate),
  );
  const positionAccounts = uniqueStrings(
    source.positions.map(({ account }) => account),
  );
  const assetLegacyIds = uniqueStrings(
    source.positions.map(({ legacyAssetId }) => legacyAssetId),
  );
  const accountCodes = uniqueStrings([
    ...portfolioAccounts.filter((code) => code !== "all"),
    ...positionAccounts,
  ]);
  const fxLegacyIds = uniqueStrings(
    source.fxRates.map(({ legacyBase44Id }) => legacyBase44Id),
  );
  const fxDates = uniqueStrings(
    source.fxRates.map(({ rateDate }) => rateDate),
  );

  let selectCount = 1;
  const queryWhen = (enabled, query) => {
    if (!enabled) return Promise.resolve([]);
    selectCount += 1;
    return query();
  };
  const [
    appUsers,
    balanceRows,
    portfolioRows,
    positionRows,
    fxRows,
    accountRows,
    assetRows,
  ] = await Promise.all([
    sql.query(`select status, role from app_users where id = $1::uuid`, [
      canonicalOwnerId,
    ]),
    queryWhen(balanceLegacyIds.length + balanceDates.length > 0, () =>
      sql.query(
        `
          select
            id::text,
            legacy_base44_id,
            canonical_owner_user_id::text,
            date::text as balance_date
          from account_balance_snapshots
          where legacy_base44_id = any($1::varchar[])
             or date = any($2::date[])
        `,
        [balanceLegacyIds, balanceDates],
      ),
    ),
    queryWhen(
      portfolioLegacyIds.length + portfolioDates.length > 0,
      () =>
        sql.query(
          `
            select
              id::text,
              legacy_base44_id,
              canonical_owner_user_id::text,
              snapshot_date::text,
              account,
              source,
              account_id::text
            from daily_portfolio_snapshots
            where legacy_base44_id = any($1::varchar[])
               or (
                 snapshot_date = any($2::date[])
                 and account = any($3::varchar[])
                 and source = 'base44_import'
               )
          `,
          [portfolioLegacyIds, portfolioDates, portfolioAccounts],
        ),
    ),
    queryWhen(positionLegacyIds.length + positionDates.length > 0, () =>
      sql.query(
        `
          select
            id::text,
            legacy_base44_id,
            canonical_owner_user_id::text,
            snapshot_date::text,
            account,
            source,
            legacy_asset_id,
            account_id::text,
            asset_id::text
          from daily_position_snapshots
          where legacy_base44_id = any($1::varchar[])
             or (
               snapshot_date = any($2::date[])
               and account = any($3::varchar[])
               and source = 'base44_import'
             )
        `,
        [positionLegacyIds, positionDates, positionAccounts],
      ),
    ),
    queryWhen(fxLegacyIds.length + fxDates.length > 0, () =>
      sql.query(
        `
          select id::text, legacy_base44_id, date::text as rate_date, status, source
          from fx_rates
          where legacy_base44_id = any($1::varchar[])
             or date = any($2::date[])
        `,
        [fxLegacyIds, fxDates],
      ),
    ),
    queryWhen(accountCodes.length > 0, () =>
      sql.query(
        `
          select id::text, code, canonical_owner_user_id::text
          from accounts
          where owner_user_id = $1
            and code = any($2::varchar[])
        `,
        [legacyOwnerUserId, accountCodes],
      ),
    ),
    queryWhen(assetLegacyIds.length > 0, () =>
      sql.query(
        `
          select id::text, legacy_base44_id, canonical_owner_user_id::text
          from assets
          where legacy_base44_id = any($1::varchar[])
        `,
        [assetLegacyIds],
      ),
    ),
  ]);

  return Object.freeze({
    appUser:
      appUsers.length === 1
        ? Object.freeze({ status: appUsers[0].status, role: appUsers[0].role })
        : null,
    balances: freezeRows(
      balanceRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
        balanceDate: row.balance_date,
      })),
    ),
    portfolios: freezeRows(
      portfolioRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
        snapshotDate: row.snapshot_date,
        account: row.account,
        source: row.source,
        accountId: row.account_id ?? null,
      })),
    ),
    positions: freezeRows(
      positionRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
        snapshotDate: row.snapshot_date,
        account: row.account,
        source: row.source,
        legacyAssetId: row.legacy_asset_id,
        accountId: row.account_id ?? null,
        assetId: row.asset_id ?? null,
      })),
    ),
    fxRates: freezeRows(
      fxRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        rateDate: row.rate_date,
        status: row.status ?? null,
        source: row.source ?? null,
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
