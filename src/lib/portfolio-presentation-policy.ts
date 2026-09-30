/** A transaction ledger records trades; it does not opt an existing holdings
 * portfolio into cash-inclusive valuation or replace its historical UI.
 * The pre-existing immutable history identifies that portfolio's convention.
 * Only static, code-owned SQL aliases may be passed here. */
export function holdingsPortfolioSql(alias: "a" | "accounts") {
  return `(${alias}.native_state is null or exists (
    select 1 from daily_portfolio_snapshots presentation_history
    where presentation_history.account_id=${alias}.id
      and presentation_history.canonical_owner_user_id=${alias}.canonical_owner_user_id
      and not presentation_history.is_sample and presentation_history.native_evidence is null
      and presentation_history.captured_at <= (${alias}.native_state->>'startedAt')::timestamptz
  ) or exists (
    select 1 from event_ledger_entries presentation_event
    where presentation_event.account_id=${alias}.id
      and presentation_event.canonical_owner_user_id=${alias}.canonical_owner_user_id
      and not presentation_event.is_sample and presentation_event.native_data is null
      and presentation_event.asset_id is not null
      and coalesce(presentation_event.recorded_at,presentation_event.created_at) <= (${alias}.native_state->>'startedAt')::timestamptz
  ))`;
}
