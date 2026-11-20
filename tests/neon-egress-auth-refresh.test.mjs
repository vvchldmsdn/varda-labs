import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { createQuoteReadRefreshGate } from '../src/lib/market-data/quote-read-refresh-gate.ts';

async function authHarness({ names = [], runtime = 'ready', sdkError = false, cookieError = false, naver = 'unauthenticated', sdkData = 'default' } = {}) {
  let calls = 0, request = 0, id = 'owner-a';
  const [raw, subject, activity] = await importWithPorts([
    'src/lib/auth/current-neon-session.ts', 'src/lib/auth/current-session-subject.ts', 'src/lib/auth/member-activity-identity.ts',
  ], {
    react: { cache: fn => {
      let generation = -1, result;
      return (...args) => { if (generation !== request) { generation = request; result = fn(...args); } return result; };
    } },
    'next/headers': { cookies: async () => {
      if (cookieError) throw Error('cookies unavailable');
      return { getAll: () => names.map(name => ({ name, value: 'synthetic' })) };
    } },
    '@/lib/auth/auth-transport-runtime': { getAuthTransportRuntime: () => ({ state: runtime, auth: { getSession: async () => {
      calls++;
      return sdkError ? { error: { message: 'unavailable' } } : { data: sdkData === 'default' ? { user: { id, emailVerified: true, email: 'member@example.test', name: 'Member' } } : sdkData };
    } } }) },
    '@/lib/auth/naver-auth-runtime': { readNaverSession: async () => naver === 'authenticated' ? { state: naver, provider: 'naver', providerSubject: 'naver-a' } : { state: naver } },
    '@/lib/auth/current-tenant-context': { resolveCurrentTenantContext: async () => ({ ok: true, tenantContext: { ownerUserId: id } }) },
  });
  return { raw, subject, activity, calls: () => calls, nextRequest(nextId) { request++; id = nextId; } };
}

test('Neon-free anonymous request avoids upstream without granting a session', async () => {
  const h = await authHarness({ names: ['locale', 'unrelated-session'] });
  assert.deepEqual(await h.raw.readCurrentNeonSession(), { state: 'unauthenticated' });
  assert.deepEqual(await h.subject.readCurrentSessionSubject(), { state: 'unauthenticated' });
  assert.equal(await h.activity.readActivityIdentity(), null);
  assert.equal(h.calls(), 0);
});

test('anonymous fast path does not hide runtime/cookie access failures', async () => {
  for (const options of [{ runtime: 'misconfigured' }, { runtime: 'disabled' }, { cookieError: true }]) {
    const h = await authHarness(options);
    assert.deepEqual(await h.raw.readCurrentNeonSession(), { state: 'unavailable' });
    assert.equal(h.calls(), 0);
  }
});

test('all SDK-prefixed cookies including chunks and challenges still require SDK verification', async () => {
  for (const name of ['__Secure-neon-auth.session_token', '__Secure-neon-auth.session_token.0', '__Secure-neon-auth.local.session_data', '__Secure-neon-auth.session_challenge', '__Secure-neon-auth.invalid']) {
    const h = await authHarness({ names: [name], sdkError: true });
    assert.deepEqual(await h.subject.readCurrentSessionSubject(), { state: 'unavailable' });
    assert.equal(h.calls(), 1);
  }
});

test('malformed non-null session payloads fail closed while an absent session remains signed out', async () => {
  for (const sdkData of [{}, [], 1, 'invalid', { user: null }, { user: [] }, { user: {} }, { user: { id: null } }]) {
    const h = await authHarness({ names: ['__Secure-neon-auth.session_token'], sdkData });
    assert.deepEqual(await h.raw.readCurrentNeonSession(), { state: 'unavailable' });
    assert.deepEqual(await h.subject.readCurrentSessionSubject(), { state: 'unavailable' });
    assert.equal(await h.activity.readActivityIdentity(), null);
  }
  const absent = await authHarness({ names: ['__Secure-neon-auth.session_token'], sdkData: null });
  assert.deepEqual(await absent.subject.readCurrentSessionSubject(), { state: 'unauthenticated' });
});

test('Naver-only login is preserved and conflicting provider identities are rejected', async () => {
  const naver = await authHarness({ names: ['__Secure-cairn-naver.session-token'], naver: 'authenticated' });
  assert.equal((await naver.subject.readCurrentSessionSubject()).provider, 'naver');
  assert.equal(naver.calls(), 0);
  const conflict = await authHarness({ names: ['__Secure-neon-auth.session_token'], naver: 'authenticated' });
  assert.deepEqual(await conflict.subject.readCurrentSessionSubject(), { state: 'invalid' });
});

test('subject and activity reuse one verified SDK result per request, never across owners', async () => {
  const h = await authHarness({ names: ['__Secure-neon-auth.session_token'] });
  assert.equal((await h.subject.readCurrentSessionSubject()).providerSubject, 'owner-a');
  assert.equal((await h.activity.readActivityIdentity()).ownerUserId, 'owner-a');
  assert.equal(h.calls(), 1);
  h.nextRequest('owner-b');
  assert.equal((await h.activity.readActivityIdentity()).ownerUserId, 'owner-b');
  assert.equal((await h.subject.readCurrentSessionSubject()).providerSubject, 'owner-b');
  assert.equal(h.calls(), 2);
});

test('manual quote page reads combine intermediate versions but immediately flush final evidence', () => {
  const gate = createQuoteReadRefreshGate();
  gate.observe('quote-1'); assert.equal(gate.take(0), true);
  gate.observe('quote-2'); assert.equal(gate.take(2_000), false);
  gate.observe('quote-3'); assert.equal(gate.take(4_000), false);
  assert.equal(gate.take(10_000), true);
  assert.equal(gate.take(20_000), false, 'unchanged evidence does not reload');
  gate.observe('fx-final'); assert.equal(gate.take(20_001, true), true);
  assert.equal(gate.take(20_002, true), false);
});

test('partial/timeout completion flushes last confirmed pending version without inventing a new one', () => {
  const gate = createQuoteReadRefreshGate();
  gate.observe('first'); assert.equal(gate.take(0), true);
  gate.observe('last-confirmed'); assert.equal(gate.take(2_000), false);
  gate.observe(undefined); assert.equal(gate.take(3_000, true), true);
  assert.equal(gate.take(4_000, true), false);
  const nextOwner = createQuoteReadRefreshGate();
  assert.equal(nextOwner.take(5_000, true), false);
});
