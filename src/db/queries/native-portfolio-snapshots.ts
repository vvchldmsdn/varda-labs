import "server-only";
import { runPortfolioMutation } from "@/lib/portfolio-mutation-transaction";
import { buildTrackedCurrencyPortfolio, type TrackedPortfolioEvidence } from "@/lib/currency-tracked-portfolio";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { TenantContext } from "@/lib/session-resolver-contract";

/** Immutable first complete capture per service day/account. Never a current-FX backfill. */
export async function saveNativeSnapshots(tenant: TenantContext, evidence: TrackedPortfolioEvidence) {
  if (tenant.ownerUserId !== evidence.ownerId || evidence.groupEvidence || !evidence.ledgerComplete || !evidence.current.scopeComplete || evidence.current.positions.some(p => p.ownerId !== tenant.ownerUserId || !p.observation || p.unsupportedReason || p.evidenceReason) || !evidence.nativeSequences) return { status: "incomplete" as const, created: 0 };
  const at = evidence.current.at;
  if (Math.abs(Date.now() - Date.parse(at)) > 60000) return { status: "stale" as const, created: 0 };
  // Validate the same price/FX evidence used by the screens before claiming a
  // complete record. A valid USD-only record need not wait for a missing KRW FX.
  const availableCurrencies = (["KRW", "USD"] as const).filter(reporting =>
    buildTrackedCurrencyPortfolio({ ...evidence, reporting }).current?.complete === true);
  if (!availableCurrencies.length) return { status: "incomplete" as const, created: 0 };
  const cycle = resolveSnapshotCycle(new Date(at));
  const payload = Object.entries(evidence.nativeSequences).map(([accountId, sequence]) => ({ accountId, sequence,
    evidence: { version: 1, sequence, availableCurrencies, frame: { at, source: "native_ledger_snapshot", scopeComplete: true, positions: evidence.current.positions.filter(p => p.accountId === accountId) }, fx: evidence.fx.filter(rate => Date.parse(rate.observedAt) <= Date.parse(at) && Date.parse(rate.fetchedAt) <= Date.now()) } }));
  const rows = await runPortfolioMutation(tenant.ownerUserId, `
    with locked_assets as materialized (select h.* from assets h where h.canonical_owner_user_id=$1::uuid order by id for update), selected as materialized (
      select a.id,a.code,p.value from accounts a join jsonb_array_elements($2::jsonb) p on a.id=(p.value->>'accountId')::uuid
      where a.canonical_owner_user_id=$1::uuid and a.is_active and (a.native_state->>'sequence')::int=(p.value->>'sequence')::int
      and not exists(select 1 from locked_assets h where h.account_id=a.id and h.archived_at is null and not exists(
        select 1 from jsonb_array_elements(p.value->'evidence'->'frame'->'positions') pos where pos->>'id'=h.id::text and (pos->'observation'->>'quantity')::numeric=h.quantity and pos->'observation'->>'currency'=h.currency))
      and not exists(select 1 from jsonb_array_elements(p.value->'evidence'->'frame'->'positions') pos where pos->>'kind' is distinct from 'cash' and (pos->'observation'->>'quantity')::numeric>0 and not exists(
        select 1 from locked_assets h where h.account_id=a.id and h.id::text=pos->>'id' and h.archived_at is null and h.quantity=(pos->'observation'->>'quantity')::numeric))
      for update of a
    ), written as (
      insert into daily_portfolio_snapshots(canonical_owner_user_id,snapshot_date,account,account_id,source,rule_version,captured_at,native_evidence)
      select $1::uuid,$3::date,code,id,'native_ledger_v1','native_ledger_v1',$4::timestamptz,value->'evidence' from selected
      where (select count(*) from selected)=jsonb_array_length($2::jsonb)
      on conflict (canonical_owner_user_id,snapshot_date,account,source) where canonical_owner_user_id is not null do nothing returning id
    ) select count(*)::int as created from written`, [tenant.ownerUserId, JSON.stringify(payload), cycle.snapshotDate, at]);
  return { status: "ready" as const, created: Number(rows[0]?.created ?? 0) };
}
