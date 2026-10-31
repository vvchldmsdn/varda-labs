import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { safeRecoveryUrl, recoveryHref, recoveryReturnHref, recoveryDestination, recoveryKind, carryRecoveryFragment } from '../src/lib/recovery-navigation.ts';

it('recovery preserves contribution drafts but never returns cached read receipts or unknown credentials', () => {
  const source = '/beta?mode=domain&scope=account%3Aabc&currency=KRW&cashAmountKrw=4321000&excludeSell=one&excludeSell=two&_betaRead=old&token=secret#beta-contribution';
  const href = recoveryHref(recoveryDestination('targets', 'account:abc', true), source);
  const destination = new URL(href, 'https://local.test');
  assert.equal(destination.pathname, '/beta/portfolio/targets');
  assert.equal(destination.searchParams.get('scope'), 'account:abc');
  const restored = new URL(recoveryReturnHref(destination.hash), 'https://local.test');
  assert.equal(restored.searchParams.get('cashAmountKrw'), '4321000');
  assert.deepEqual(restored.searchParams.getAll('excludeSell'), ['one', 'two']);
  assert.equal(restored.searchParams.has('_betaRead'), false);
  assert.equal(restored.searchParams.has('token'), false);
  assert.equal(restored.hash, '#beta-contribution');
  assert.equal(destination.searchParams.has('cashAmountKrw'), false, 'draft belongs in the client fragment, not a destination server query');
});
it('native draft keeps funding currency separate from reporting currency', () => {
  const source = '/additional-contribution?scope=account%3Aabc&currency=KRW&fundingCurrency=USD&amount=101.27&useCash=1&excludeSell=asset';
  const href = recoveryHref('/portfolio/targets?scope=account%3Aabc', source);
  assert.equal(recoveryReturnHref(new URL(href, 'https://local.test').hash), source);
});
it('history and research restore display conditions without inventing a result', () => {
  for (const source of [
    '/history?scope=all&currency=USD&period=1Y&metric=return&date=2026-09-14',
    '/beta/history?mode=domain&scope=all&currency=KRW&_historyDate=2026-09-14&_historyMetric=return&_historyPeriod=3M',
    '/simulation?scope=account%3Aabc&end=2026-10-26&horizon=63',
    '/investment-lab?scope=all&start=2026-08-01&end=2026-10-26',
    '/investment-lab?scope=all&start=2026-09-01&end=2026-10-26&basketAnchor=2026-09-18&kodexWeight=60',
  ]) assert.equal(recoveryReturnHref(new URL(recoveryHref('/portfolio/holdings', source), 'https://local.test').hash), source);
});
it('recovery rejects external, malformed, oversized and unsupported return routes', () => {
  for (const source of ['https://other.test/', '//other.test/', '/\\other.test', '/auth/callback?token=x', '/api/native-contribution-plans', '/unknown', '/history\n', 'javascript:alert(1)', '/history?q='+'x'.repeat(16000)]) {
    assert.equal(safeRecoveryUrl(source), null, source.slice(0, 50));
    assert.equal(recoveryHref('/portfolio/targets', source), null);
  }
  assert.equal(recoveryReturnHref('#cairn-return=%ZZ'), null);
  assert.equal(recoveryReturnHref('#cairn-return=%2F%2Fevil.test'), null);
  assert.equal(recoveryHref('//other.test', '/history'), null);
});
it('successful target refresh carries a validated continuation without nesting fragments', () => {
  const original = '/beta?mode=domain&scope=all&cashAmountKrw=3200000#beta-contribution';
  const href = recoveryHref('/beta/portfolio/targets', original);
  const fragment = new URL(href, 'https://local.test').hash;
  const refreshed = carryRecoveryFragment('/beta/portfolio/targets?_betaRead=new#target-editor', fragment);
  assert.equal(new URL(refreshed, 'https://local.test').searchParams.get('_betaRead'), 'new');
  assert.equal(recoveryReturnHref(new URL(refreshed, 'https://local.test').hash), original);
  assert.equal(safeRecoveryUrl(href), '/beta/portfolio/targets');
  assert.equal(carryRecoveryFragment('/beta#target-editor', '#cairn-return=javascript%3Aalert(1)'), '/beta#target-editor');
});
it('read failures take precedence over editable data and missing FX does not send users to target approval', () => {
  assert.equal(recoveryKind(['targets_missing', 'query_failed']), 'retry');
  assert.equal(recoveryKind(['approved_targets_required']), 'targets');
  assert.equal(recoveryKind(['target_universe_changed']), 'targets');
  assert.equal(recoveryKind(['fx_unavailable']), 'market');
  assert.equal(recoveryKind(['observations_missing']), 'market');
  assert.equal(recoveryKind(['cost_basis_missing']), 'trades');
  assert.equal(recoveryKind(['holdings_empty']), 'holdings');
  for (const reason of ['planning_valuation_mismatch', 'planning_vector_mismatch', 'planning_policy_mismatch']) {
    assert.equal(recoveryKind([reason]), 'retry', 'read disagreements must not ask the user to edit valid holdings');
  }
  assert.equal(recoveryKind(['planning_valuation_incomplete']), 'holdings');
  assert.equal(recoveryDestination('retry', 'all', true), null);
  assert.equal(new URL(recoveryDestination('market', 'account:abc', true), 'https://local.test').pathname, '/portfolio/holdings');
  assert.equal(new URL(recoveryDestination('history', 'account:abc', true), 'https://local.test').searchParams.get('detail'), 'raw');
});

const [{ RecoveryNotice }, { ContributionHome }] = await importUiWithPorts(['src/components/recovery/recovery-notice.tsx', 'src/components/cairn-v2/home-contribution.tsx'], {
  'next/navigation': { useRouter: () => ({ refresh() {}, push() {} }) },
});
it('readonly recovery still offers a retry while withholding edit navigation and a false return promise', () => {
  const html = renderToStaticMarkup(createElement(RecoveryNotice, { kind:'targets', allowResolve:false }));
  assert.match(html, /다시 조회/);
  assert.doesNotMatch(html, /설정하기|입력을 유지한 채 돌아올/);
});
it('history recovery explicitly distinguishes later corrections from historical return evidence', () => {
  const html = renderToStaticMarkup(createElement(RecoveryNotice, { kind:'history' }));
  assert.match(html, /저장 기록 확인하기/);
  assert.match(html, /현재 원가 수정만으로 과거 평가와 수익률이 만들어지지는/);
});
it('beta contribution card explains blocked reads without showing internal codes or fabricated results', () => {
  const read = (state, blockers) => ({ state, blockers, result: null, message: '추가 투자 계산 보류 · ' + blockers.join(' · ') });
  const render = (contribution, dirty = false) => renderToStaticMarkup(createElement(ContributionHome, {
    view: { domain: { state: 'ready', planning: { contribution } } }, dirty,
  }));
  for (const [state, blockers, expected] of [
    ['blocked', ['target_policy_missing'], /목표비중/],
    ['blocked', ['target_policy_missing', 'query_failed'], /자료를 다시/],
    ['blocked', ['target_policy_conflict'], /자료를 다시/],
    ['blocked', ['price_unavailable'], /가격·환율/],
    ['unavailable', ['target_policy_missing'], /자료를 다시/],
  ]) {
    const html = render(read(state, blockers));
    assert.match(html, expected);
    for (const code of blockers) assert.equal(html.includes(code), false);
    assert.doesNotMatch(html, /총 매수 배분|data-funding-amount/);
  }
  const dirty = render(read('blocked', ['target_policy_missing']), true);
  assert.match(dirty, /입력 변경/);
  assert.doesNotMatch(dirty, /목표비중|target_policy_missing/);
  const ready = render({ state: 'ready', blockers: [], result: {
    cashAmountKrw: 10000, rows: [], residualCashKrw: 10000, totalAllocatedKrw: 0,
    totalAvailableFundsKrw: 10000, totalTrimProceedsKrw: 0,
  } });
  assert.match(ready, /총 매수 배분<\/dt><dd>0/);
  assert.match(ready, /data-funding-amount="10000"/);
});
