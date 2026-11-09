import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { labTradePeriod, nativeLabDefaultWindow } from '../src/lib/investment-lab-native-period.ts';
import { loadInvestmentLabCounterfactualReadModel } from '../src/lib/investment-lab-counterfactual-read-loader.ts';

const scope = { kind: 'account', key: 'account:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountCode: 'brokerage' };
const params = { mode: 'domain', currency: 'KRW', scope: scope.key, run: '1', start: '2026-01-05', end: '2026-01-08' };
const dates = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];
const period = { selectedStartServiceDate: dates[0], selectedEndServiceDate: dates[3], reason: null };
const segment = (role, days) => ({ role, rows: days.map(serviceDate => ({ serviceDate, totalMarketValueKrw: 5000 })) });
const issue = (date, reason = 'fx_missing') => ({ date, label: '테스트 ETF', reason });

test('period candidate only uses one observed current-writer segment after the last in-range issue', () => {
  const result = labTradePeriod(period, [segment('legacy_display', [dates[0]]), segment('current_writer', dates.slice(1))], {
    blocked: [issue('2025-01-01'), { ...issue(dates[0]), privateEvent: 'never sent' }, issue('2027-01-01')],
    valued: [{ date: dates[1], basis: 'historical_fx' }, { date: dates[3], basis: 'reported_execution_krw' }],
  });
  assert.deepEqual(result.blocked, [issue(dates[0])]);
  assert.deepEqual(result.candidate, { start: dates[2], end: dates[3] }, 'skip an otherwise valued trade at the proposed starting observation');
  assert.deepEqual(result.valued, { recorded_krw: 0, historical_fx: 1, reported_execution_krw: 1 });
  assert.doesNotMatch(JSON.stringify(result), /privateEvent|2025-01-01|2027-01-01/);
});

test('one observation in each segment does not form a range, even with two dates on screen', () => {
  const segments = [segment('current_writer', [dates[1]]), segment('current_writer', [dates[2]]), segment('legacy_display', [dates[3]])];
  assert.equal(labTradePeriod(period, segments, { blocked: [issue(dates[0])] }).candidate, null);
  assert.equal(labTradePeriod({ ...period, reason: 'end_not_observed' }, segments, { blocked: [issue(dates[0])] }), null);
  assert.equal(labTradePeriod(period, segments, { blocked: [issue('2025-01-01')] }), null);
});

test('the comparison notice shows the affected publicly named trade, an explicit dated run button, and no financial totals', async () => {
  const query = new URLSearchParams(params);
  const [{ BetaLab }, { labKey }] = await importUiWithPorts([
    'src/components/cairn-v2/beta-lab.tsx', 'src/lib/cairn-v2/lab-contract.ts',
  ], {
    'next/navigation': { useSearchParams: () => query, useRouter: () => ({ push() { throw Error('render navigated'); } }) },
    'next/link': { default: () => null },
    '@/components/cairn-v2/beta-provider': { useBetaReadFreshness: () => null, useBetaExistingCrudAvailable: () => false },
    '@/components/cairn-v2/beta-shell': { BetaShell: ({ children }) => children },
    '@/components/holding-analysis-recovery': { HoldingAnalysisRecovery: () => null },
    '@/components/recovery/recovery-notice': { RecoveryNotice: () => null },
    '@/components/investment-lab/investment-lab-comparison-chart': { InvestmentLabComparisonChart: () => { throw Error('rendered a blocked result'); } },
  });
  const segments = [segment('current_writer', dates)];
  const tradeEvidence = labTradePeriod(period, segments, { blocked: [issue(dates[1]), issue(dates[1])] });
  const read = {
    state: 'blocked', message: 'fixture', scopes: [], queryKey: labKey(params),
    model: { period: { ...period, status: 'unavailable', reason: 'range_evidence_incomplete' }, tradeEvidence,
      observedHistory: { status: 'ready', segments, coverage: { admittedDateCount: dates.length, skippedDateCount: 0 } },
      scopeEvidence: { includedAccountCodes: ['brokerage'] }, fount: {}, funding: null,
      comparison: { status: 'blocked', rows: [], summary: null, returns: null, blockers: [], scenario: {}, coverage: {} } },
  };
  const html = renderToStaticMarkup(createElement(BetaLab, { read }));
  assert.match(html, /거래 당시 원화 금액/);
  assert.match(html, /테스트 ETF/);
  assert.equal(html.match(/<time dateTime="2026-01-06"/gi)?.length, 1);
  assert.match(html, /2026-01-07 ~ 2026-01-08 비교 실행/);
  assert.match(html, /저장 출처별 실제 평가액 관측 경로/);
  assert.doesNotMatch(html, /KODEX 200 가상 경로 · KRW|실제 기말 평가 · KRW/);
});

test('anchor-day trade holds back the otherwise ready KODEX result; an explicit new period runs once with its own results', async () => {
  const [{ readBetaLab }, { labHref }] = await importUiWithPorts(['src/lib/cairn-v2/lab-service.ts', 'src/lib/cairn-v2/lab-contract.ts'], {});
  const events = [{ eventDate: dates[0], eventType: 'buy', sequence: 1, account: 'brokerage', amountKrw: 100,
    quantityDelta: 1, price: 100, fxRate: null, assetCurrency: 'KRW', isCorrection: false }];
  const repo = {
    loadEvents: async () => events,
    loadSnapshots: async () => dates.map(snapshotDate => ({ snapshotDate, account: 'brokerage',
      source: 'varda_manual_daily_snapshot', ruleVersion: 'varda-manual-daily-snapshot-v1', totalMarketValue: 5000, cashValue: 0, usdKrw: 1200 })),
    loadScenarioCloses: async () => ['2026-01-02', ...dates].map(priceDate => ({ priceDate, closePrice: 100, adjustedClosePrice: 100, source: 'fixture' })),
    loadVooCloses: async () => [], loadFxRows: async () => [],
    loadAnchorPositionRows: async () => [], loadAnchorPriceRows: async () => [],
  };
  const evidence = { engineAccount: 'brokerage', includedAccountCodes: ['brokerage'], nativeTradeEvidence: { blocked: [], valued: [{ date: dates[0], basis: 'recorded_krw' }] }};
  let runs = 0;
  const ports = {
    session: async () => ({ ok: true, tenantContext: { ownerUserId: 'synthetic' }}),
    scopes: async () => ({ state: 'ready', resolution: { state: 'resolved', scope }, catalog: { scopes: [scope] }}),
    evidence: async () => evidence,
    research: async ({request}) => {
      runs++;
      const source = await loadInvestmentLabCounterfactualReadModel(repo, request, undefined, undefined, 'brokerage');
      assert.equal(source.model.status, 'ready', 'the original date-only engine omits anchor-day flows');
      return source;
    },
  };
  const first = await readBetaLab(params, ports);
  assert.equal(runs, 1, 'finding a candidate must not run another study');
  assert.equal(first.state, 'blocked');
  assert.equal(first.model.period.status, 'unavailable');
  assert.equal(first.model.comparison.status, 'blocked');
  assert.equal(first.model.comparison.summary, null);
  assert.deepEqual(first.model.comparison.rows, []);
  assert.equal(first.model.comparison.returns, null);
  assert.equal(first.model.funding, null);
  assert.deepEqual(first.model.tradeEvidence.candidate, { start: dates[1], end: dates[3] });
  const href = new URL(labHref(first.context, { ...first.model.tradeEvidence.candidate, run: '1' }, 'test-epoch'), 'https://cairn.invalid');
  assert.equal(href.searchParams.get('scope'), scope.key);
  assert.equal(href.searchParams.get('_betaRead'), 'test-epoch');
  assert.equal(href.hash, '#lab-comparison');
  const next = await readBetaLab(Object.fromEntries(href.searchParams), ports);
  assert.equal(runs, 2);
  assert.equal(next.state, 'ready');
  assert.equal(next.model.tradeEvidence, null);
  assert.equal(next.model.comparison.summary.startServiceDate, dates[1]);
  assert.equal(next.model.comparison.summary.endServiceDate, dates[3]);
  assert.equal(next.model.comparison.summary.actualEndValueKrw, 5000);
});

test('default scoped read runs the original model once on verified observations; explicit dates and legacy defaults retain their own ranges', async () => {
  const price = priceDate => ({priceDate, closePrice: 100, adjustedClosePrice: 100, source: 'fixture'});
  const snapshotRows = dates.map(snapshotDate => ({ snapshotDate, account: 'brokerage',
    source: 'varda_manual_daily_snapshot', ruleVersion: 'varda-manual-daily-snapshot-v1', totalMarketValue: 5000, cashValue: 0, usdKrw: 1200 }));
  const evidence = {snapshotRows, nativeTradeEvidence: {
    blocked: [issue(dates[0], 'opening_boundary')],
    valued: [{date: dates[0], basis: 'recorded_krw'}],
  }, eventRows: [], engineAccount: 'brokerage', anchorPositionRows: [], supportsLegacyTargetPolicy: false,
    fountAdjustment: {status: 'not_applicable'}, includedAccountCodes: ['brokerage']};
  let runs = 0, admittedPrices = true;
  const [query, service] = await importUiWithPorts(['src/db/queries/investment-lab.ts', 'src/lib/cairn-v2/lab-service.ts'], {
    '@/db/client': {db: {}},
    '@/lib/investment-lab-counterfactual-read-loader': {
      loadInvestmentLabCounterfactualReadModel: (repository, ...args) => {
        runs++;
        // Scoped events, snapshots and financial calculations are the real code.
        return loadInvestmentLabCounterfactualReadModel({
          ...repository,
          loadScenarioCloses: async () => admittedPrices ? ['2026-01-02', ...dates].map(price) : [],
          loadVooCloses: async () => [], loadFxRows: async () => [],
        }, ...args);
      },
    },
    '@/db/queries/target-policy': { getReadOnlyTenantApprovedTargetPolicy: () => { throw Error('unexpected target read'); } },
    '@/db/queries/target-policy-holding-universe': { getReadOnlyTenantTargetPolicyHoldingUniverse: () => { throw Error('unexpected universe read'); } },
  });
  const ports = {
    session: async () => ({ok:true,tenantContext:{ownerUserId:'synthetic'}}),
    scopes: async () => ({state:'ready',resolution:{state:'resolved',scope},catalog:{scopes:[scope]}}),
    evidence: async () => evidence,
    research: query.getReadOnlyTenantInvestmentLabCounterfactualForScope,
  };
  const simple = {mode:'domain',scope:scope.key,currency:'KRW'};
  assert.equal((await service.readBetaLab(simple, ports)).state, 'idle');
  assert.equal(runs, 0);
  const adjusted = await service.readBetaLab({...simple,run:'1'}, ports);
  assert.equal(runs, 1);
  assert.equal(adjusted.state, 'ready');
  assert.deepEqual(adjusted.model.defaultContext, {
    originalStart:dates[0],originalEnd:dates[3],lastBlockedDate:dates[0],reasons:['opening_boundary'],
  });
  assert.equal(adjusted.model.period.status, 'current_writer');
  assert.equal(adjusted.model.period.requestedStartServiceDate, null);
  assert.equal(adjusted.model.period.requestedEndServiceDate, null);
  assert.equal(adjusted.model.period.selectedStartServiceDate, dates[1]);
  assert.equal(adjusted.model.comparison.summary.startServiceDate, dates[1]);
  assert.equal(adjusted.model.comparison.summary.endServiceDate, dates[3]);
  const explicit = await service.readBetaLab(params, ports);
  assert.equal(runs, 2);
  assert.equal(explicit.state, 'blocked');
  assert.equal(explicit.model.defaultContext, null);
  assert.equal(explicit.model.period.requestedStartServiceDate, dates[0]);
  assert.equal(explicit.model.comparison.summary, null);
  admittedPrices = false;
  const insufficient = await service.readBetaLab({...simple,run:'1'}, ports);
  assert.equal(runs, 3);
  assert.equal(insufficient.state, 'blocked', 'default selection does not upgrade a price blocker');
  assert.equal(insufficient.model.comparison.summary, null);
  admittedPrices = true;
  const legacy = await service.readBetaLab({...simple,run:'1'}, {...ports,evidence:async()=>({...evidence,nativeTradeEvidence:undefined})});
  assert.equal(runs, 4);
  assert.equal(legacy.state, 'ready');
  assert.equal(legacy.model.defaultContext, null);
  assert.equal(legacy.model.comparison.summary.startServiceDate, dates[0]);
  assert.equal(nativeLabDefaultWindow(evidence, {startServiceDate:dates[0]}), null, 'even an invalid explicit request is not rewritten');
});
