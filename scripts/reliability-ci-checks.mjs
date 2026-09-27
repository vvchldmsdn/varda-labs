import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { childEnvironment, JOBS, parseOptions, SOURCE_DIRECTORIES, SOURCE_FILES, stageSource } from './reliability-ci.mjs';
import { permitsConnection } from './reliability-ci-network.mjs';

test('regular workflow always checks every PR/master with stable names and read-only permissions', async () => {
  const text = await readFile(new URL('../.github/workflows/reliability.yml', import.meta.url), 'utf8');
  const workflow = load(text);
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push']);
  assert.equal(workflow.on.pull_request, null);
  assert.deepEqual(workflow.on.push, { branches: ['master'] });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), JOBS);
  assert.doesNotMatch(text, /secrets\.|pull_request_target|git\s+(?:push|commit)|db:migrate|build:vercel|GH_TOKEN|GITHUB_TOKEN/);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.name, name);
    assert.equal(job.if, undefined, 'Required job cannot disappear due to a condition');
    assert.equal(job.permissions, undefined, 'Job cannot elevate workflow permissions');
    assert.equal(job.environment, undefined, 'No deployment environment or its secrets');
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 30);
    const check = job.steps.find(step => step.run?.startsWith(`node scripts/reliability-ci.mjs --job ${name}`));
    assert.ok(check, `${name} must use the same local/CI orchestrator`);
    assert.equal(check.if, undefined);
    if (['postgres-integration', 'browser-journeys'].includes(name)) {
      assert.match(check.run, /--pg-bin \/usr\/lib\/postgresql\/16\/bin$/);
      assert.ok(job.steps.some(step => step.run?.includes('apt-get install --yes postgresql-16')));
    }
    const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.with['persist-credentials'], false);
    for (const step of job.steps.filter(step => step.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
});

test('CI arguments cannot select a remote DB or silently omit PostgreSQL tools', () => {
  for (const job of JOBS.filter(job => !['postgres-integration', 'browser-journeys'].includes(job))) assert.equal(parseOptions(['--job', job]).job, job);
  for (const job of ['postgres-integration', 'browser-journeys', 'all']) {
    assert.throws(() => parseOptions(['--job', job]));
    assert.throws(() => parseOptions(['--job', job, '--pg-bin', 'relative-bin']));
    const pgBin = path.resolve('synthetic-pg-bin');
    assert.equal(parseOptions(['--job', job, '--pg-bin', pgBin]).pgBin, pgBin);
  }
  assert.throws(() => parseOptions(['--job', 'postgres-integration', '--database-url', 'postgresql://example.test/db']));
  assert.throws(() => parseOptions(['--job', 'production-build', '--skip-build']));
  assert.throws(() => parseOptions(['--job', 'typo']));
  assert.equal(parseOptions(['--validate-only']).validateOnly, true);
});

test('parent database/auth/provider secrets, Git token, preload and homes never reach jobs', () => {
  const stage = path.resolve('output/synthetic-stage');
  const env = childEnvironment({ PATH: 'synthetic-path', DATABASE_URL: 'private-db', TENANT_DATABASE_URL: 'private-tenant',
    NEON_AUTH_COOKIE_SECRET: 'private-cookie', KIS_APP_SECRET: 'private-provider', TWELVE_DATA_API_KEY: 'private-provider',
    GH_TOKEN: 'private-token', GITHUB_TOKEN: 'private-token', NODE_OPTIONS: '--require private-hook',
    HOME: 'private-home', USERPROFILE: 'private-home', PGHOST: 'private-host', PGSERVICEFILE: 'private-service' }, stage, 'unit-tests');
  assert.equal(env.PATH, 'synthetic-path');
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(env.DATABASE_URL).port, '1');
  assert.ok(!JSON.stringify(env).includes('private-'));
  assert.equal(env.HOME, path.join(stage, 'output/isolated-home'));
  assert.equal(env.CAIRN_CI_ALLOW_FONT_NETWORK, '0');
  assert.match(env.NODE_OPTIONS, /^--import=file:/);
});

test('actual socket interception rejects provider/database hosts before a connection attempt', async () => {
  assert.equal(permitsConnection({ host: '127.0.0.1' }), true);
  assert.equal(permitsConnection({ host: 'localhost' }), true);
  assert.equal(permitsConnection({ host: '::1' }), true);
  assert.equal(permitsConnection({ host: 'fonts.googleapis.com' }), false);
  assert.equal(permitsConnection({ host: 'fonts.googleapis.com' }, true), true);
  assert.equal(permitsConnection({ host: 'api.twelvedata.com' }, true), false);
  for (const host of ['db.example.test', 'api.twelvedata.com', '127.0.0.1.example.test', '192.0.2.1']) {
    const socket = new net.Socket();
    assert.throws(() => socket.connect({ host, port: 443 }), { code: 'CAIRN_CI_EXTERNAL_NETWORK_BLOCKED' });
    socket.destroy();
  }
  await assert.rejects(fetch('https://provider.invalid/fixture'), error => error.cause?.code === 'CAIRN_CI_EXTERNAL_NETWORK_BLOCKED');
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
      socket.on('error', reject); socket.on('close', resolve);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('staging includes pending source edits but excludes envs and deployment/QA directories', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'cairn-ci-copy-'));
  const root = path.join(base, 'source'), stage = path.join(base, 'stage');
  await mkdir(root); await mkdir(stage);
  try {
    for (const name of SOURCE_DIRECTORIES) await mkdir(path.join(root, name), { recursive: true });
    for (const name of SOURCE_FILES) await writeFile(path.join(root, name), 'synthetic');
    await mkdir(path.join(root, 'node_modules'));
    for (const name of ['.env.local', 'src/.env.local']) await writeFile(path.join(root, name), 'private-fixture-marker');
    await mkdir(path.join(root, '.vercel')); await writeFile(path.join(root, '.vercel/private.json'), 'private-fixture-marker');
    await writeFile(path.join(root, 'src/pending-change.ts'), 'export const preserved = true;');
    await stageSource(root, stage);
    assert.match(await readFile(path.join(stage, 'src/pending-change.ts'), 'utf8'), /preserved/);
    for (const name of ['.env.local', 'src/.env.local', '.vercel', '.git']) await assert.rejects(access(path.join(stage, name)));
    assert.equal(await realpath(path.join(stage, 'node_modules')), await realpath(path.join(root, 'node_modules')));
    const maliciousStage = path.join(base, 'symlink-stage'); await mkdir(maliciousStage);
    await symlink(path.join(root, '.vercel'), path.join(root, 'src/escaped'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(stageSource(root, maliciousStage), /Source symlink rejected/);
  } finally {
    // A fresh mkdtemp path, checked before native single-shell filesystem cleanup.
    assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
    assert.ok(path.basename(base).startsWith('cairn-ci-copy-'));
    await rm(base, { recursive: true, force: true });
  }
});
