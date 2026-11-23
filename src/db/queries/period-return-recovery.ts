import 'server-only';
import { runTenantReadTransaction } from '@/db/tenant-transaction-context';
import type { TenantContext } from '@/lib/session-resolver-contract';
import { parseRecoveredReturnCurve } from '@/lib/period-return-recovery';
import { matchesRecoveredClose } from '@/lib/cairn-v2/period-performance';
import { PERFORMANCE_ENDS_SQL } from '@/lib/cairn-v2/period-attribution-sql';
import { toNumber } from '@/lib/portfolio-math';

/** The standalone recovery view requires the latest revision. The performance
 * timeline also admits a later, identifiable trade revision strictly after
 * the matched closing valuation. Its earliest effective timestamp is returned
 * for comparison with the selected snapshot's actual cutoff. */
export function ownedRecoveredReturnSql(withRange = false) {
  return `
      SELECT jsonb_set(e.native_data->'request'->'returnRecovery','{points}',
        (SELECT jsonb_agg(CASE WHEN p.value->'valueKrw'='null'::jsonb AND v.value_krw IS NOT NULL
          THEN jsonb_set(p.value,'{valueKrw}',to_jsonb(v.value_krw)) ELSE p.value END ORDER BY p.ordinality)
         FROM jsonb_array_elements(case when jsonb_typeof(e.native_data#>'{request,returnRecovery,points}')='array'
           then e.native_data#>'{request,returnRecovery,points}' else '[]'::jsonb end) WITH ORDINALITY p(value,ordinality)
         LEFT JOIN recovered_close_valuations v ON v.account_id=e.account_id
           AND v.canonical_owner_user_id=e.canonical_owner_user_id AND v.revision=r.marker_sequence
           AND v.valuation_date::text=p.value->>'date')) AS recovery
      ${withRange ? ", subsequent.first_affected_at::text as revised_from" : ""}
      FROM event_ledger_entries e JOIN accounts a ON a.id=e.account_id AND a.canonical_owner_user_id=e.canonical_owner_user_id
      JOIN native_ledger_revisions r ON r.account_id=e.account_id AND r.canonical_owner_user_id=e.canonical_owner_user_id AND r.operation_id=e.native_operation_id AND r.marker_sequence=e.native_sequence
      ${withRange ? `CROSS JOIN LATERAL (
        -- A date-only fill is stored at the midpoint of its service day.
        -- Use the earliest possible impact, including a replaced fill, when retaining a prior close.
        SELECT min(case when marker.native_data#>>'{request,event,dateEvidence,precision}'='date_only'
                   then later.affected_at - interval '12 hours' else later.affected_at end) as first_affected_at,
          count(*) filter (where later.affected_at is null or marker.native_operation_id is null) as unclassified
        FROM public.native_ledger_revisions later
        LEFT JOIN public.event_ledger_entries marker on not marker.is_sample
              and marker.canonical_owner_user_id=later.canonical_owner_user_id and marker.account_id=later.account_id
              and marker.native_operation_id=later.operation_id and marker.native_sequence=later.marker_sequence
              and marker.event_type='native_revision' and marker.rule_version='native_revision_v1'
              and marker.native_data#>>'{event,type}'='revision'
              and marker.native_data#>>'{request,accountId}'=later.account_id::text
              and marker.native_data#>'{request,history,notInOpening}'='true'::jsonb
              and marker.native_data#>>'{request,event,type}' in ('buy','sell')
              and marker.native_data#>>'{request,event,at}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
              and (marker.native_data#>>'{request,event,dateEvidence}' is null or (
                marker.native_data#>>'{request,event,dateEvidence,precision}'='date_only'
                and marker.native_data#>>'{request,event,dateEvidence,timeZone}'='Asia/Seoul'
                and marker.native_data#>>'{request,event,dateEvidence,policy}'='service_day_midpoint'
                and marker.native_data#>>'{request,event,at}'=(marker.native_data#>>'{request,event,dateEvidence,reportedDate}') || 'T10:00:00.000Z'
                and to_char(later.affected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <= marker.native_data#>>'{request,event,at}'
              ))
        WHERE later.account_id=r.account_id
          AND later.canonical_owner_user_id=r.canonical_owner_user_id AND later.marker_sequence>r.marker_sequence
      ) subsequent` : ""}
      WHERE e.canonical_owner_user_id=$1::uuid AND e.account_id=$2::uuid AND a.is_active AND NOT e.is_sample
        AND e.event_type='native_revision' AND e.rule_version='broker_evidence_recovery_v1'
        AND e.native_data->'request'->>'kind'='broker_evidence_recovery'
        AND e.native_data->'request'->'returnRecovery'->>'accountId'=a.id::text
        AND e.native_data->'request'->'returnRecovery'->>'revision'=r.marker_sequence::text
        ${withRange ? "AND e.native_data#>>'{request,returnRecovery,baseDate}' >= $3 AND e.native_data#>>'{request,returnRecovery,endDate}' <= $4" : ""}
        ${withRange ? "AND subsequent.unclassified=0" :
          "AND NOT EXISTS(SELECT 1 FROM native_ledger_revisions later WHERE later.account_id=r.account_id AND later.canonical_owner_user_id=r.canonical_owner_user_id AND later.marker_sequence>r.marker_sequence)"}
      ORDER BY e.native_sequence DESC LIMIT 1`;
}

type Row = Readonly<Record<string, unknown>>;
export function recoveredCurveAtClose(row: Row | undefined, ends: readonly Row[], accountId: string) {
  const curve = parseRecoveredReturnCurve(row?.recovery);
  if (!curve || row?.revised_from == null) return curve;
  const end = ends.find(s => s.account_id === accountId && s.date === curve.endDate);
  const value = curve.points.at(-1)?.valueKrw;
  if (!end || end.frame_at || value == null) return null;
  const cutoff = Math.max(Date.parse(curve.endDate + 'T22:00:00Z'),
    typeof end.execution_end_at === 'string' ? Date.parse(end.execution_end_at) : 0);
  if (!(Date.parse(String(row.revised_from)) > cutoff)) return null;
  return matchesRecoveredClose({ date: curve.endDate, accountId, source: String(end.source),
    expectedPositions: toNumber(end.expected_positions), recoveryOpeningKrw: toNumber(end.recovery_opening_krw),
    positions: Array.isArray(end.positions) ? end.positions : [] }, value) ? curve : null;
}

export async function readRecoveredReturnCurve(tenant: TenantContext, accountId: string, forPerformance = false) {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  try {
    const params = forPerformance ? [tenant.ownerUserId, accountId, '0001-01-01', '9999-12-31'] : [tenant.ownerUserId, accountId];
    const [rows] = await runTenantReadTransaction(tenant.ownerUserId, tx => [tx.query(ownedRecoveredReturnSql(forPerformance), params)]);
    const curve = parseRecoveredReturnCurve(rows[0]?.recovery);
    if (!curve || rows[0]?.revised_from == null) return curve;
    // Only accounts with a later trade need to reverify the original actual close.
    // Re-read the revision alongside it so a concurrent edit cannot retain an invalid anchor.
    const [checked, ends] = await runTenantReadTransaction(tenant.ownerUserId, tx => [
      tx.query(ownedRecoveredReturnSql(true), [tenant.ownerUserId, accountId, curve.baseDate, curve.endDate]),
      tx.query(PERFORMANCE_ENDS_SQL, [accountId, curve.endDate, curve.endDate]),
    ]);
    return recoveredCurveAtClose(checked[0], ends, accountId);
  } catch { return null; }
}
