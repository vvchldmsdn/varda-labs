export async function readBase44SettingsCanonicalState(
  sql,
  { canonicalOwnerId },
) {
  const [appUsers, settingsRows] = await Promise.all([
    sql.query(
      `select status, role from app_users where id = $1::uuid`,
      [canonicalOwnerId],
    ),
    sql.query(`
      select legacy_base44_id, canonical_owner_user_id::text
      from settings
      order by created_at, id
    `),
  ]);

  return Object.freeze({
    appUser:
      appUsers.length === 1
        ? Object.freeze({ status: appUsers[0].status, role: appUsers[0].role })
        : null,
    databaseRows: Object.freeze(
      settingsRows.map((row) =>
        Object.freeze({
          legacyBase44Id: row.legacy_base44_id,
          canonicalOwnerUserId: row.canonical_owner_user_id ?? null,
        }),
      ),
    ),
    selectCount: 2,
    databaseSideEffects: false,
  });
}
