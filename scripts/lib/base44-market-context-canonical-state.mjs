export async function readBase44MarketContextCanonicalState(
  sql,
  {
    canonicalOwnerId,
    legacyOwnerUserId,
    source,
  },
) {
  const regimeLegacyIds = uniqueStrings(
    source.marketRegimes.map(({ legacyBase44Id }) => legacyBase44Id),
  );
  const regimeDates = uniqueStrings(
    source.marketRegimes.map(({ regimeDate }) => regimeDate),
  );
  const regimeAccounts = uniqueStrings(
    source.marketRegimes.map(({ account }) => account),
  );
  const accountCodes = regimeAccounts.filter((code) => code !== "all");
  const factorLegacyIds = uniqueStrings(
    source.globalFactors.map(({ legacyBase44Id }) => legacyBase44Id),
  );
  const factorDates = uniqueStrings(
    source.globalFactors.map(({ factorDate }) => factorDate),
  );
  const factorKeys = uniqueStrings(
    source.globalFactors.map(({ factorKey }) => factorKey),
  );

  let selectCount = 1;
  const queryWhen = (enabled, query) => {
    if (!enabled) return Promise.resolve([]);
    selectCount += 1;
    return query();
  };
  const [appUsers, regimeRows, accountRows, factorRows] = await Promise.all([
    sql.query(`select status, role from app_users where id = $1::uuid`, [
      canonicalOwnerId,
    ]),
    queryWhen(regimeLegacyIds.length + regimeDates.length > 0, () =>
      sql.query(
        `
          select
            id::text,
            legacy_base44_id,
            canonical_owner_user_id::text,
            date::text as regime_date,
            account,
            account_id::text
          from market_regime_daily
          where legacy_base44_id = any($1::varchar[])
             or (
               date = any($2::date[])
               and account = any($3::varchar[])
             )
        `,
        [regimeLegacyIds, regimeDates, regimeAccounts],
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
    queryWhen(factorLegacyIds.length + factorDates.length > 0, () =>
      sql.query(
        `
          select id::text, legacy_base44_id, date::text as factor_date, factor_key
          from global_market_factors
          where legacy_base44_id = any($1::varchar[])
             or (
               date = any($2::date[])
               and factor_key = any($3::varchar[])
             )
        `,
        [factorLegacyIds, factorDates, factorKeys],
      ),
    ),
  ]);

  return Object.freeze({
    appUser:
      appUsers.length === 1
        ? Object.freeze({ status: appUsers[0].status, role: appUsers[0].role })
        : null,
    marketRegimes: freezeRows(
      regimeRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
        regimeDate: row.regime_date,
        account: row.account,
        accountId: row.account_id ?? null,
      })),
    ),
    accounts: freezeRows(
      accountRows.map((row) => ({
        id: row.id,
        code: row.code,
        canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
      })),
    ),
    globalFactors: freezeRows(
      factorRows.map((row) => ({
        id: row.id,
        legacyBase44Id: row.legacy_base44_id,
        factorDate: row.factor_date,
        factorKey: row.factor_key,
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
