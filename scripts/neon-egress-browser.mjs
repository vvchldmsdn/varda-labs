import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { ROOT, stageSource, childEnvironment } from './reliability-ci.mjs';

// Disposable synthetic presentation harness only. No credentials, real users,
// provider calls, DB setup or production-route backdoors are introduced.
assert.ok(process.argv.length <= 3 && [undefined, '--prepare-only', '--run'].includes(process.argv[2]));
const output = await mkdtemp(path.join(ROOT, 'output', 'neon-egress-browser-'));
const stage = path.join(output, 'workspace');
await mkdir(stage);
await stageSource(ROOT, stage);
await assert.rejects(access(path.join(ROOT, 'src/app/qa-neon-egress')), { code: 'ENOENT' });
const { importUiWithPorts } = await import('../tests/helpers/import-ui-with-ports.mjs');
const [fixtures, contract] = await importUiWithPorts(['src/lib/cairn-v2/fixtures.ts', 'src/lib/cairn-v2/read-contract.ts'], {});
const { betaVisualFixture } = await import('../tests/support/beta-visual-fixture.mjs');
const context = { mode: 'domain', scope: 'all', currency: 'KRW', fixture: 'standard' };
const binding = 'a'.repeat(64), epoch = '11111111-1111-4111-8111-111111111111';
const portfolioRows = Array.from({ length: 360 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 11, 1 + index)).toISOString().slice(0, 10);
  return { snapshotDate: date, valuationDate: date, storageSnapshotDate: date,
    source: 'varda_manual_daily_snapshot', account: 'all', rowKind: 'stored', derivedFromAccounts: [],
    totalMarketValue: 20_000_000 + index * 1200 + Math.round(Math.sin(index / 14) * 200000), totalReturnPct: null };
});
const history = { selectedScope: { kind: 'all', key: 'all', label: 'QA portfolio' }, readStatus: 'ready',
  observationPolicy: 'production_observed_v1', portfolioRows, recoveredReturn: null };
const base = betaVisualFixture(fixtures.getFixtureView(context), contract.blankDomainView('ready', ''));
const view = contract.applyBetaHistory(base, { ...history, portfolioRows: portfolioRows.slice(-190) }, 'KRW').view;
const read = { context, view, historyWindow: 'recent', displayBinding: binding, readReceipt: 'parent-read-1', readEpoch: epoch };
const full = { scope: 'all', currency: 'KRW', displayBinding: binding, readReceipt: 'full-read-1', readEpoch: epoch, history };
const simulation = { context: { ...context, run: '1' }, state: 'unavailable', message: 'QA 시뮬레이션 응답', model: null,
  scopes: [], serviceDate: null, generatedAt: null, displayBinding: binding, readReceipt: 'simulation-read-1', readEpoch: epoch };
await writeFile(path.join(stage, 'public/qa-neon-egress-fixture.json'), JSON.stringify({ full, simulation }));
const route = path.join(stage, 'src/app/qa-neon-egress');
await mkdir(route);
await writeFile(path.join(route, 'fixture.json'), JSON.stringify(read));
await writeFile(path.join(route, 'page.tsx'), `
import { Fixture } from './fixture';
export default function Page() { return <Fixture />; }
`);
await writeFile(path.join(route, 'fixture.tsx'), `
'use client';
import { useEffect, useState } from 'react';
import { BetaProvider } from '@/components/cairn-v2/beta-provider';
import { BetaHome } from '@/components/cairn-v2/beta-home';
import type { DomainRead } from '@/lib/cairn-v2/read-contract';
import data from './fixture.json';
export function Fixture() {
  const [generation, setGeneration] = useState(0);
  useEffect(() => { const change = () => setGeneration(value => value + 1);
    addEventListener('cairn-qa-parent-read', change); return () => removeEventListener('cairn-qa-parent-read', change); }, []);
  const read = { ...data, readReceipt: 'parent-read-' + (generation + 1),
    displayBinding: (generation ? 'b' : 'a').repeat(64) } as unknown as DomainRead;
  return <BetaProvider><BetaHome initialContext={read.context} read={read}/></BetaProvider>;
}
`);
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const baseURL = `http://127.0.0.1:${port}`;
await writeFile(path.join(stage, 'playwright.egress.config.ts'), `
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', testMatch: 'neon-egress.spec.ts', workers: 1,
  retries: 0, reporter: [['list'], ['json', {outputFile: ${JSON.stringify(path.join(output, 'results.json'))}}]],
  outputDir: ${JSON.stringify(path.join(output, 'screenshots'))},
  use: { baseURL: ${JSON.stringify(baseURL)}, browserName: 'chromium', locale: 'ko-KR',
    reducedMotion: 'reduce', serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
`);
const { chromium } = await import('@playwright/test');
const browserCache = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
const environment = { ...childEnvironment(process.env, stage, 'production-build', browserCache), CAIRN_EGRESS_BROWSER_QA: '1' };
await writeFile(path.join(output, 'prepared.json'), JSON.stringify({ stage, baseURL, scope: 'synthetic UI and lazy-fetch behavior only',
  excluded: ['live authentication', 'production DB', 'provider failures', 'actual research results', 'physical touch devices'],
  isolation: { inheritedCredentials: false, db: 'dead localhost port', browser: 'fresh profile', fixtureRoutes: 'disposable copy only' } }, null, 2));
console.log(JSON.stringify({ prepared: output, stage, baseURL }));
if (process.argv[2] !== '--run') process.exit(0);

const log = createWriteStream(path.join(output, 'server.log'));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)],
  { cwd: stage, env: environment, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
try {
  const deadline = Date.now() + 120_000;
  let online = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('Disposable Next server exited; inspect server.log');
    try { online = (await fetch(baseURL + '/qa-neon-egress-fixture.json')).ok; } catch { /* startup */ }
    if (online) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(online, 'Disposable Next server did not start');
  const code = await new Promise((resolve, reject) => {
    const browser = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.egress.config.ts'],
      { cwd: stage, env: environment, windowsHide: true, shell: false, stdio: 'inherit' });
    browser.once('error', reject); browser.once('close', resolve);
  });
  process.exitCode = code === 0 ? 0 : 1;
} finally {
  // Only the child process started by this harness and its own descendants.
  if (server.exitCode === null && server.pid) {
    if (process.platform === 'win32') await new Promise(resolve => {
      const stop = spawn('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      stop.once('close', resolve); stop.once('error', resolve);
    }); else server.kill('SIGTERM');
  }
  await new Promise(resolve => log.end(resolve));
  await assert.rejects(access(path.join(ROOT, 'src/app/qa-neon-egress')), { code: 'ENOENT' });
}
