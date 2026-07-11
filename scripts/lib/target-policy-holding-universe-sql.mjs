export const TARGET_POLICY_HOLDING_UNIVERSE_ROW_COUNT_SQL = `
  select count(*)::int as assets
  from assets
`;

export const TARGET_POLICY_HOLDING_UNIVERSE_SQL = `
  select
    name,
    lower(trim(market)) as market,
    upper(trim(currency)) as currency,
    nullif(upper(trim(ticker)), '') as ticker
  from assets
  where lower(trim(account)) = $1
    and (quantity > 0 or coalesce(fractional_krw_value, 0) > 0)
  order by market, currency, ticker nulls last, name
`;
