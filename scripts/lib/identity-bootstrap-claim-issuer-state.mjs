export async function readIdentityBootstrapClaimIssuerState(
  sql,
  targetAppUserId,
) {
  const [catalog] = await sql.query(`
    select
      to_regclass('public.identity_pairing_intents')::text
        as intents_table,
      to_regclass('public.identity_pairing_intent_events')::text
        as events_table
  `);
  if (!catalog?.intents_table || !catalog?.events_table) {
    return Object.freeze({
      schemaAvailable: false,
      targetFound: false,
      targetStatus: null,
      targetRole: null,
      targetProviderIdentityCount: 0,
      openIntentCount: 0,
    });
  }

  const rows = await sql.query(
    `
      with evaluation_clock as materialized (
        select clock_timestamp() as evaluated_at
      )
      select
        target.id is not null as target_found,
        target.status as target_status,
        target.role as target_role,
        (
          select count(*)::int
          from auth_identities identity_row
          where identity_row.app_user_id = $1::uuid
            and identity_row.provider = 'neon_auth'
        ) as target_provider_identity_count,
        (
          select count(*)::int
          from identity_pairing_intents intent
          left join identity_pairing_intent_events terminal_event
            on terminal_event.identity_pairing_intent_id = intent.id
          cross join evaluation_clock
          where intent.target_app_user_id = $1::uuid
            and intent.provider = 'neon_auth'
            and terminal_event.id is null
            and intent.expires_at > evaluation_clock.evaluated_at
        ) as open_intent_count
      from (select 1) seed
      left join app_users target on target.id = $1::uuid
    `,
    [targetAppUserId],
  );
  const row = rows[0];
  if (!row) throw new Error("Identity bootstrap claim issuer state is missing");

  return Object.freeze({
    schemaAvailable: true,
    targetFound: row.target_found === true,
    targetStatus: row.target_status ?? null,
    targetRole: row.target_role ?? null,
    targetProviderIdentityCount: Number(
      row.target_provider_identity_count ?? 0,
    ),
    openIntentCount: Number(row.open_intent_count ?? 0),
  });
}
