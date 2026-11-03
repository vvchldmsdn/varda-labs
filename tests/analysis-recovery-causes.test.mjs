import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { recoveryKind, recoveryDestination } from '../src/lib/recovery-navigation.ts';
import { currencyRecoveryKind } from '../src/lib/recovery-currency.ts';
import { dataIssueLabel } from '../src/lib/data-issue-presentation.ts';
import { simulationRecoveryReasons } from '../src/lib/cairn-v2/simulation-recovery.ts';
import { trackedCurrencyFixture } from '../src/lib/currency-tracked-fixture.ts';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';

const account = '11111111-1111-4111-8111-111111111111', scope = `account:${account}`;
const walk = value => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : [];
const words = value => Array.isArray(value) ? value.map(words).join(' ') : value && typeof value === 'object' ? words(value.props?.children) : typeof value === 'string' ? value : '';
const i18n = { useI18n: () => ({ locale: 'ko', t: ko => ko }) };

test('cash recovery reaches the selected account ledger while service evidence issues offer no false collection route', () => {
  for (const classify of [recoveryKind, currencyRecoveryKind]) {
    assert.equal(classify(['cash_not_observed', 'valuation_incomplete']), 'cash');
    assert.equal(classify(['corporate_action_evidence_missing']), 'market_review');
    assert.equal(classify(['price_observation_conflict']), 'market_review');
    assert.equal(classify(['fx_conflict']), 'market_review');
    assert.equal(classify(['conflicting_provider_binding']), 'market_review');
    assert.equal(classify(['corporate_action_ledger_mismatch']), 'trades');
    assert.equal(classify(['fx_missing']), 'market');
    assert.equal(classify(['query_failed', 'corporate_action_evidence_missing']), 'retry');
  }
  for (const beta of [false, true]) {
    const destination = new URL(recoveryDestination('cash', scope, beta), 'https://local.test');
    assert.equal(destination.pathname, beta ? '/beta/portfolio/ledger' : '/portfolio/ledger');
    assert.equal(destination.searchParams.get('accountId'), account);
    assert.equal(destination.searchParams.get('scope'), scope);
    assert.equal(recoveryDestination('market_review', scope, beta), null);
  }
  assert.match(dataIssueLabel('corporate_action_evidence_missing'), /가격 수집만으로 해결되지/);
  assert.match(dataIssueLabel('price_observation_conflict'), /출처가 서로 달라/);
  assert.notEqual(dataIssueLabel('fx_missing'), dataIssueLabel('fx_stale'));
  assert.equal(dataIssueLabel('stale_fx'), dataIssueLabel('fx_stale'));
});

test('service review notice provides one reread action without a collection or return promise', async () => {
  const [{ RecoveryNotice }] = await importUiWithPorts(['src/components/recovery/recovery-notice.tsx'], { 'next/navigation': { useRouter: () => ({ refresh() {}, push() {} }) } });
  const html = renderToStaticMarkup(createElement(RecoveryNotice, { reasons: ['corporate_action_evidence_missing'], scope }));
  assert.match(html, /시장 자료 확인이 필요/); assert.match(html, /다시 확인하기/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /분석 데이터 준비 확인|입력을 유지한 채 돌아올/);
  const cash = renderToStaticMarkup(createElement(RecoveryNotice, { reasons: ['cash_not_observed'], scope }));
  assert.match(cash, /잔액·정산 기록 확인하기/);
});

test('partial-result recovery starts collapsed while blocking recovery keeps its action visible', async () => {
  let retried = 0;
  const [{ RecoveryNotice }] = await importUiWithPorts(['src/components/recovery/recovery-notice.tsx'], {
    react: { useTransition: () => [false, action => action()] },
    'next/navigation': { useRouter: () => ({ refresh() {}, push() {} }) },
    '@/components/i18n/locale-provider': i18n,
  });
  for (const presentation of ['inline', 'blocking']) {
    const tree = RecoveryNotice({ kind: 'retry', scope, presentation, onRetry: () => retried++ });
    const detail = walk(tree).find(node => node.type === 'details');
    const button = walk(tree).find(node => typeof node.props?.onClick === 'function');
    if (presentation === 'inline') {
      assert.ok(detail); assert.ok(!detail.props.open);
      assert.ok(walk(detail).includes(button), 'partial-result action belongs inside its disclosure');
    } else {
      assert.ok(button); assert.ok(!detail || !walk(detail).includes(button), 'blocking action must not be collapsed');
    }
    button.props.onClick();
  }
  assert.equal(retried, 2);
});

test('a failed recalculation after a successful simulation still exposes retry with the edited draft', async t => {
  let stateIndex = 0, failed = false;
  const Notice = () => null, navigation = [];
  const result = { composition: { rows: [], complete: false }, issues: [{ code: 'fx_missing' }],
    simulation: { horizon: 63, paths: [], summary: { bands: [], terminal: { lossProbabilityPct: 0 } } },
    metadata: { sources: [], bases: [] } };
  const [{ CurrencyResearchView }] = await importUiWithPorts(['src/components/currency-research-view.tsx'], {
    'next/link': { default: () => null },
    react: { useState: initial => [[result, false, failed][stateIndex++] ?? initial, () => {}], useMemo: fn => fn(), useEffect() {} },
    'next/navigation': { useRouter: () => ({ replace: href => navigation.push(href), refresh() {} }) },
    '@/components/i18n/locale-provider': i18n,
    '@/components/recovery/recovery-notice': { RecoveryNotice: Notice },
    '@/components/recovery/use-navigation-draft': { useNavigationDraft: ({ initial }) => [{ ...initial, horizon: 63, step: 17, fields: ['100'] }, () => {}, false] },
  });
  const props = { surface: 'simulation', recoveryScope: scope, evidence: { provenance: 'owned_native_history', reportingCurrency: 'USD',
    input: { version: 3, rows: [], asOf: '2026-10-03T00:00:00Z' }, histories: [] } };
  const element = CurrencyResearchView(props);
  let nodes = walk(element.type(element.props));
  assert.equal(nodes.find(node => node.type === Notice).props.presentation, 'inline');
  failed = true; stateIndex = 0;
  nodes = walk(element.type(element.props));
  const retry = nodes.find(node => node.type === Notice);
  assert.ok(retry, 'the retained old result must not hide failed-recalculation recovery');
  assert.equal(retry.props.kind, 'retry'); assert.equal(retry.props.presentation, 'blocking');
  assert.equal(nodes.some(node => node.props?.id === 'research-simulation'), false);
  const prior = globalThis.location;
  globalThis.location = new URL(`https://local.test/simulation?scope=${scope}&currency=USD`);
  t.after(() => { if (prior === undefined) delete globalThis.location; else globalThis.location = prior; });
  retry.props.onRetry();
  const returned = new URL(navigation[0], location);
  const draft = JSON.parse(returned.searchParams.get('_nativeView'));
  assert.equal(returned.searchParams.get('scope'), scope); assert.equal(draft.currency, 'USD');
  assert.equal(draft.horizon, 63); assert.equal(draft.step, 17); assert.deepEqual(draft.fields, ['100']);
});

test('beta retains specific historical causes without changing execution or retaining success warnings', () => {
  const model = { execution: { status: 'unavailable', reason: 'historical_evidence_not_admitted' }, candidate: { blockers: [], instruments: [
    { admissionStatus: 'fx_incomplete', storedCoverage: { reasons: ['missing_fx'] }, provenance: { issues: [] } },
    { admissionStatus: 'price_history_incomplete', storedCoverage: { reasons: ['missing_fx', 'missing_price'] }, provenance: { issues: ['price_observation_conflict'] } },
  ] } };
  const original = structuredClone(model);
  assert.deepEqual(simulationRecoveryReasons(model), ['historical_evidence_not_admitted', 'fx_incomplete', 'missing_fx', 'price_history_incomplete', 'missing_price', 'price_observation_conflict']);
  assert.deepEqual(model, original);
  assert.deepEqual(simulationRecoveryReasons({ ...model, execution: { status: 'ready' } }), []);
});

test('native planner and beta simulation deliver the causes to recovery while preserving input context', async () => {
  const Notice = () => null;
  const loaded = { context: { status: 'blocked', reason: 'valuation_incomplete', evidenceReasons: ['cash_not_observed'] }, plans: [] };
  const context = { mode: 'domain', scope, currency: 'KRW' };
  let stateIndex = 0, planner = true;
  const ports = {
    react: { useState: initial => [planner && stateIndex++ === 0 ? loaded : typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {}, useLayoutEffect() {}, useRef: () => ({ current: null }), useTransition: () => [false, () => {}] },
    'next/navigation': { useRouter: () => ({}), usePathname: () => '/beta/additional-contribution', useSearchParams: () => new URLSearchParams({ ...context, amount: '321.50', fundingCurrency: 'USD', useCash: '1' }) },
    'next/link': { default: () => null },
    '@/components/i18n/locale-provider': i18n,
    '@/components/recovery/recovery-notice': { RecoveryNotice: Notice },
    '@/components/cairn-v2/beta-provider': { useBetaExistingCrudAvailable: () => true, useBetaReadFreshness: () => null },
    '@/components/cairn-v2/beta-shell': { BetaShell: () => null },
    '@/components/cairn-v2/use-beta-context': { useBetaContext: () => [context, () => {}] },
    '@/components/cairn-v2/simulation-result-detail': { default: () => null },
    '@/components/holding-analysis-recovery': { HoldingAnalysisRecovery: () => null },
  };
  const [{ NativeContributionPlanner }, { BetaSimulation }] = await importUiWithPorts(['src/components/native-contribution-planner.tsx', 'src/components/cairn-v2/beta-simulation.tsx'], ports);
  const native = walk(NativeContributionPlanner({ scopeKey: scope, currency: 'KRW' })).find(node => node.type === Notice);
  assert.deepEqual(native.props.reasons, ['cash_not_observed', 'valuation_incomplete']);
  assert.equal(native.props.draft.amount, '321.50'); assert.equal(native.props.draft.fundingCurrency, 'USD'); assert.equal(native.props.draft.useCash, '1');
  planner = false;
  const read = { context, state: 'unavailable', message: 'Insufficient evidence', scopes: [], model: { execution: { status: 'unavailable', reason: 'historical_evidence_not_admitted' }, candidate: { blockers: [], instruments: [{ admissionStatus: 'fx_incomplete', storedCoverage: { reasons: ['missing_fx'] }, provenance: { issues: [] } }] } } };
  const beta = walk(BetaSimulation({ read })).find(node => node.type === Notice);
  assert.deepEqual(beta.props.reasons, ['historical_evidence_not_admitted', 'fx_incomplete', 'missing_fx']); assert.equal(beta.props.scope, scope);
  assert.equal(beta.props.source, 'current', 'a newly started analysis must not inherit an older management return');
});

test('readiness UI distinguishes no holdings, basic preparation and an FX-only service dependency', async () => {
  let savedRead = { scope, result: { state: 'ready', entries: [] } }, progress = null, stateIndex = 0;
  const state = initial => [stateIndex++ === 0 ? savedRead : initial, () => {}];
  const common = {
    '@/components/i18n/locale-provider': i18n,
    '@/app/portfolio/holdings/actions': { readHoldingAnalysisScope: async () => { throw new Error('unexpected read'); }, readHoldingAnalysisProgress: async () => { throw new Error('unexpected read'); }, prepareHoldingAnalysisData: () => { throw new Error('unexpected write'); } },
    '@/components/holding-analysis-data-panel': { HoldingAnalysisDataPanelView: () => null },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/components/cairn-ui/client': { useActionFormReset: () => ({ formRef: null, onReset() {} }) },
  };
  const [{ HoldingAnalysisRecovery }] = await importUiWithPorts(['src/components/holding-analysis-recovery.tsx'], { ...common, react: { useState: state, useRef: () => ({ current: 0 }) } });
  assert.match(words(HoldingAnalysisRecovery({ scope })), /확인할 보유종목이 없습니다/);
  savedRead = { scope, result: { state: 'ready', entries: [{ readiness: { state: 'ready' } }] } }; stateIndex = 0;
  const prepared = words(HoldingAnalysisRecovery({ scope }));
  assert.match(prepared, /종목별 기본 이력/); assert.doesNotMatch(prepared, /시작 보유|분석 준비 완료/);

  const [{ HoldingAnalysisDataForm }] = await importUiWithPorts(['src/components/holding-analysis-data-form.tsx'], { ...common, react: {
    useState: initial => [stateIndex++ === 0 ? progress : initial, () => {}], useEffect() {}, useRef: () => ({ current: null }), useActionState: (_, initial) => [initial, () => {}, false],
  } });
  const base = { state: 'limited', reason: 'simulation_history_incomplete', simulationReady: false, trendReady: true, observationCount: 130, latestSourceDate: '2026-09-01', canPrepare: true, missingInputs: ['historical_fx'] };
  stateIndex = 0; progress = { collection: { state: 'done', completed: 1, total: 1 }, readiness: base };
  const fxTree = HoldingAnalysisDataForm({ holdingId: account, readiness: base });
  assert.match(words(fxTree), /가격 수집 완료/); assert.match(words(fxTree), /환율은 서비스에서 보완/);
  assert.doesNotMatch(words(fxTree), /시뮬레이션 가능|분석 준비 완료/);
  assert.equal(walk(fxTree).some(node => node.type === 'form'), false, 'price collection cannot supply the only missing FX');
  stateIndex = 0; progress = null;
  assert.ok(walk(HoldingAnalysisDataForm({ holdingId: account, readiness: { ...base, missingInputs: ['prices', 'historical_fx'] } })).some(node => node.type === 'form'), 'actual price gaps still offer collection');
});

test('native planning projects actual admitted valuation causes without reading markets or changing its block', async () => {
  let evidence = trackedCurrencyFixture(), scoped = true, reads = 0;
  const [query] = await importWithPorts(['src/db/queries/native-contribution-context.ts'], {
    '@/db/queries/portfolio-analysis-scopes': { getReadOnlyTenantPortfolioAnalysisScopeContext: async () => scoped ? { state: 'ready', resolution: { state: 'resolved', scope: { kind: 'account', key: scope, accountId: account, label: 'Synthetic' } } } : { state: 'unavailable' } },
    '@/db/queries/currency-tracked-portfolio': { getTrackedCurrencyEvidence: async () => { reads++; return evidence; } },
    '@/db/queries/portfolio-target-policy': { getReadOnlyTenantPortfolioTargetPolicyModel: async () => ({ status: 'unavailable' }) },
    '@/db/queries/native-portfolio-ledger': { readNativeLedger: async () => { throw new Error('unexpected ledger read'); } },
    '@/db/queries/additional-contribution-ma120': { getReadOnlyTenantAdditionalContributionMa120Evidence: async () => { throw new Error('unexpected market read'); } },
    '@/db/queries/additional-contribution-modifiers': { readAdditionalContributionModifiers: async () => { throw new Error('unexpected modifier read'); } },
  });
  for (const cause of ['native_price_evidence_missing', 'cash_not_observed', 'corporate_actions_pending', 'fx_missing']) {
    evidence = trackedCurrencyFixture(); evidence.ledgerComplete = true;
    evidence.current.positions[0].accountId = account;
    if (cause === 'native_price_evidence_missing') evidence.current.positions[0].observation = null;
    else if (cause === 'cash_not_observed') evidence.current.positions[0].unsupportedReason = cause;
    else if (cause === 'corporate_actions_pending') evidence.current.positions[0].evidenceReason = cause;
    else { evidence.reporting = 'KRW'; evidence.fx = []; }
    const original = structuredClone(evidence);
    const result = await query.readNativeContributionContext({ ownerUserId: evidence.ownerId }, scope, evidence.reporting);
    assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'valuation_incomplete');
    assert.deepEqual(result.evidenceReasons, [cause]); assert.deepEqual(evidence, original);
    assert.equal(JSON.stringify(result).includes(evidence.ownerId), false, 'only issue codes cross the UI boundary');
  }
  scoped = false; const before = reads;
  assert.equal((await query.readNativeContributionContext({ ownerUserId: 'other' }, scope, 'USD')).reason, 'scope_unavailable');
  assert.equal(reads, before, 'scope rejection precedes all evidence reads');
});
