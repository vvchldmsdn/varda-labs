import 'server-only';
import { runTenantReadTransaction } from '@/db/tenant-transaction-context';
import type { TenantContext } from '@/lib/session-resolver-contract';
import { parseRecoveredReturnCurve } from '@/lib/period-return-recovery';

/** Owner predicate, RLS, active owned account, and latest effective revision all
 * apply. A later historical correction invalidates this captured recovery. */
export async function readRecoveredReturnCurve(tenant: TenantContext, accountId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  try {
    const [rows] = await runTenantReadTransaction(tenant.ownerUserId, tx => [tx.query(`
      SELECT jsonb_set(e.native_data->'request'->'returnRecovery','{points}',
        (SELECT jsonb_agg(CASE WHEN p.value->'valueKrw'='null'::jsonb AND v.value_krw IS NOT NULL
          THEN jsonb_set(p.value,'{valueKrw}',to_jsonb(v.value_krw)) ELSE p.value END ORDER BY p.ordinality)
         FROM jsonb_array_elements(e.native_data->'request'->'returnRecovery'->'points') WITH ORDINALITY p(value,ordinality)
         LEFT JOIN recovered_close_valuations v ON v.account_id=e.account_id
           AND v.canonical_owner_user_id=e.canonical_owner_user_id AND v.revision=r.marker_sequence
           AND v.valuation_date::text=p.value->>'date')) AS recovery
      FROM event_ledger_entries e JOIN accounts a ON a.id=e.account_id AND a.canonical_owner_user_id=e.canonical_owner_user_id
      JOIN native_ledger_revisions r ON r.account_id=e.account_id AND r.canonical_owner_user_id=e.canonical_owner_user_id AND r.operation_id=e.native_operation_id AND r.marker_sequence=e.native_sequence
      WHERE e.canonical_owner_user_id=$1::uuid AND e.account_id=$2::uuid AND a.is_active
        AND e.event_type='native_revision' AND e.rule_version='broker_evidence_recovery_v1'
        AND e.native_data->'request'->>'kind'='broker_evidence_recovery'
        AND e.native_data->'request'->'returnRecovery'->>'accountId'=a.id::text
        AND e.native_data->'request'->'returnRecovery'->>'revision'=r.marker_sequence::text
        AND NOT EXISTS(SELECT 1 FROM native_ledger_revisions later WHERE later.account_id=r.account_id AND later.canonical_owner_user_id=r.canonical_owner_user_id AND later.marker_sequence>r.marker_sequence)
      ORDER BY e.native_sequence DESC LIMIT 1`, [tenant.ownerUserId, accountId])]);
    return parseRecoveredReturnCurve(rows[0]?.recovery);
  } catch { return null; }
}
