export const SAVE_EFFECT_SQL = `insert into contribution_effects(owner_user_id,id,account_id,document)
      select $1::uuid,$2::uuid,$3::uuid,$4::jsonb where exists(select 1 from accounts where id=$3::uuid and canonical_owner_user_id=$1::uuid and is_active)
      and not exists(select 1 from jsonb_each_text($5::jsonb) e where not exists(select 1 from accounts a where a.id=e.key::uuid and a.canonical_owner_user_id=$1::uuid and a.native_state->>'sequence'=e.value))
      and (select count(*)=1 from portfolio_target_policy_revisions p where p.lifecycle_status='approved' and p.scope_kind='account' and p.scope_account_id=$3::uuid
        and p.approval_revision=($6::jsonb->>'revision')::integer and p.universe_hash=$6::jsonb->>'universeHash' and p.vector_hash=$6::jsonb->>'vectorHash' and p.policy_version=$6::jsonb->>'version')
      and (select count(*) from contribution_effects where owner_user_id=$1::uuid)<100 on conflict do nothing returning id`;

export const LINK_EFFECT_SQL = `update contribution_effects set trade_ids=$4::jsonb,revision=revision+1 where owner_user_id=$1::uuid and id=$2::uuid and account_id=$3::uuid and revision=$5
      and not exists(select 1 from contribution_effects other where other.owner_user_id=$1::uuid and other.id<>$2::uuid and other.trade_ids ?| array(select jsonb_array_elements_text($4::jsonb)))
      and (select count(*) from effective_native_ledger_entries e where e.canonical_owner_user_id=$1::uuid and e.account_id=$3::uuid and e.id::text in (select jsonb_array_elements_text($4::jsonb)))=jsonb_array_length($4::jsonb) returning id`;
