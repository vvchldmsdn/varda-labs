import type { InvestmentLabAnalysisScopeEvidence } from './investment-lab-analysis-scope.ts';
import { buildInvestmentLabObservedHistory, type InvestmentLabObservedHistorySegment } from './investment-lab-observed-history-segments.ts';
import { resolveInvestmentLabPeriodSelection, type InvestmentLabPeriodRequest, type InvestmentLabPeriodSelection } from './investment-lab-period-selection.ts';
import { listInvestmentLabCompleteSnapshotDates, listInvestmentLabLatestCurrentWriterDates } from './investment-lab-source-segment-authority.ts';

/** These are observed dates to try, never a verified alternative result. */
export function labTradePeriod(
  period: InvestmentLabPeriodSelection,
  segments: readonly InvestmentLabObservedHistorySegment[],
  evidence?: InvestmentLabAnalysisScopeEvidence['nativeTradeEvidence'],
) {
  if (!evidence || (period.reason && period.reason !== 'range_evidence_incomplete')) return null;
  const start = period.selectedStartServiceDate ?? period.availableStartServiceDate;
  const end = period.selectedEndServiceDate ?? period.availableEndServiceDate;
  if (!start || !end) return null;

  // Anchor-day unknowns cannot be placed before or after the saved observation.
  const blocked = evidence.blocked
    .filter(row => row.date >= start && row.date <= end)
    .map(({ date, label, reason }) => ({ date, label, reason }))
    .concat((evidence.valued ?? []).filter(row => row.date === start)
      .map(({date}) => ({ date, label: null, reason: 'opening_boundary' as const })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const valued = { recorded_krw: 0, reported_execution_krw: 0, historical_fx: 0 };
  for (const row of evidence.valued ?? []) {
    if (row.date > start && row.date <= end) valued[row.basis]++;
  }
  if (blocked.length === 0 && Object.values(valued).every(count => count === 0)) return null;
  const lastBlocked = blocked.at(-1)?.date;
  const tradeDates = new Set(evidence.valued?.map(row => row.date));
  let candidate: { start: string; end: string } | null = null;
  // The observed history model orders segments and rows by service date.
  for (let i = segments.length - 1; lastBlocked && i >= 0; i--) {
    const segment = segments[i];
    if (segment.role !== 'current_writer') continue;
    const dates = segment.rows.filter(({ serviceDate }) => serviceDate > lastBlocked && serviceDate <= end);
    const first = dates.find(row => !tradeDates.has(row.serviceDate))?.serviceDate;
    const last = dates.at(-1)?.serviceDate;
    if (!first || !last || first >= last) continue;
    candidate = { start: first, end: last };
    break;
  }
  return { blocked, candidate, valued };
}

/** Pick dates from already scoped evidence; the normal loader still decides all financial results. */
export function nativeLabDefaultWindow(evidence: InvestmentLabAnalysisScopeEvidence, request?: InvestmentLabPeriodRequest) {
  const { nativeTradeEvidence: trades, snapshotRows, engineAccount } = evidence;
  if (request || !trades || (!trades.blocked.length && !trades.valued.length)) return null;
  const base = resolveInvestmentLabPeriodSelection({
    availableServiceDates: listInvestmentLabCompleteSnapshotDates(snapshotRows, engineAccount),
    defaultServiceDates: listInvestmentLabLatestCurrentWriterDates(snapshotRows, engineAccount),
  });
  const start = base.selectedStartServiceDate, end = base.selectedEndServiceDate;
  if (base.status !== 'current_writer' || !start || !end) return null;
  if (!trades.blocked.some(row => row.date >= start && row.date <= end) && !trades.valued.some(row => row.date === start)) return null;
  const observations = buildInvestmentLabObservedHistory(snapshotRows.filter(row => row.snapshotDate >= start && row.snapshotDate <= end), engineAccount);
  const decision = labTradePeriod(base, observations.segments, trades);
  if (!decision?.candidate) return null;
  const lastBlockedDate = decision.blocked[decision.blocked.length - 1].date;
  return {
    request: { startServiceDate: decision.candidate.start, endServiceDate: decision.candidate.end },
    context: {
      originalStart: start, originalEnd: end, lastBlockedDate,
      reasons: [...new Set(decision.blocked.filter(row => row.date === lastBlockedDate).map(row => row.reason))],
    },
  };
}
