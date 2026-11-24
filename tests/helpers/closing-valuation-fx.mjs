import {ECB_VALUATION_POLICY, ECB_VALUATION_SOURCE, ecbReferenceDate} from '../../src/lib/market-data/ecb-valuation-fx.ts';

/** Public-data-shaped receipt for synthetic, isolated closing fixtures. */
export function fixtureClosingFx(serviceDate, rate = '1100') {
  const cutoffAt = new Date(serviceDate + 'T07:00:00+09:00').toISOString();
  const id = '00000000-0000-4000-8000-0000' + serviceDate.replaceAll('-', '');
  return {
    base: 'USD', quote: 'KRW', rate, source: ECB_VALUATION_SOURCE,
    kind: 'daily_reference', observedAt: cutoffAt, fetchedAt: cutoffAt,
    fixing: {id, serviceDate, referenceDate: ecbReferenceDate(serviceDate), cutoffAt,
      evidenceKind: 'closing_reference', policy: ECB_VALUATION_POLICY},
  };
}

export async function seedFixtureClosingFx(client, serviceDate, rate = '1100') {
  const row = fixtureClosingFx(serviceDate, rate);
  const {id, referenceDate, policy, evidenceKind} = row.fixing;
  await client.query(`insert into daily_valuation_fx
    (id, service_date, base_currency, quote_currency, reference_date, rate, krw_per_eur, usd_per_eur, source, policy, evidence_kind, fetched_at)
    values($1, $2, 'USD', 'KRW', $3, $4, $4, 1, $5, $6, $7, $8)`,
    [id, serviceDate, referenceDate, row.rate, row.source, policy, evidenceKind, row.fetchedAt]);
  return row;
}
