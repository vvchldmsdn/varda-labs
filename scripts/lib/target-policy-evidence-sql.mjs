export const TARGET_POLICY_ASSETS_SQL = `
  select
    id::text as ref,
    account,
    market,
    currency,
    ticker,
    target_weight,
    group_id::text as direct_group_ref
  from assets
  order by account, id
`;

export const TARGET_POLICY_GROUPS_SQL = `
  select
    id::text as ref,
    target_weight,
    execution_mode,
    is_active
  from asset_groups
  order by id
`;

export const TARGET_POLICY_MEMBERS_SQL = `
  select
    group_id::text as group_ref,
    asset_id::text as asset_ref,
    allocation_ratio,
    priority,
    is_active
  from asset_group_members
  order by group_id, asset_id
`;

export const TARGET_POLICY_ROW_COUNTS_SQL = `
  select
    (select count(*)::int from assets) as assets,
    (select count(*)::int from asset_groups) as asset_groups,
    (select count(*)::int from asset_group_members) as asset_group_members
`;
