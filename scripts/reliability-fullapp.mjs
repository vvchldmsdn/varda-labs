import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, stageSource, childEnvironment } from './reliability-ci.mjs';

/** Substitute only the external verified identity boundary in a disposable source copy. */
export async function prepareFullApp(stage) {
  await stageSource(ROOT, stage);
  const fixture = path.join(stage, 'src/lib/auth/current-session-subject.ts');
  await writeFile(fixture, `import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import type { CurrentSessionSubjectResult } from './provider-session-contract';
export type { CurrentSessionSubjectResult } from './provider-session-contract';
export const readCurrentSessionSubject = cache(async (): Promise<CurrentSessionSubjectResult> => {
  const token = (await cookies()).get('cairn_fullapp_identity')?.value;
  const identities = JSON.parse(process.env.CAIRN_FULLAPP_IDENTITIES ?? '{}') as Record<string,string>;
  const subject = token ? identities[token] : undefined;
  return subject ? {state:'authenticated',provider:'neon_auth',providerSubject:subject} : {state:'unauthenticated'};
});
`);
  return { identityBoundary: 'external verified session subject substituted only in disposable build',
    sourceIdentitySha256: createHash('sha256').update(await readFile(path.join(ROOT, 'src/lib/auth/current-session-subject.ts'))).digest('hex') };
}

export async function main(args) {
  assert.ok(args.length === 2 || args.length === 4, 'Use --pg-bin <absolute PostgreSQL binary directory> [--output-dir <absolute empty directory>]');
  assert.equal(args[0], '--pg-bin'); assert.ok(path.isAbsolute(args[1]));
  const outputRoot = path.join(ROOT, 'output/reliability-fullapp');
  await mkdir(outputRoot, { recursive: true });
  if (args.length === 4) { assert.equal(args[2], '--output-dir'); assert.ok(path.isAbsolute(args[3])); }
  const output = args.length === 4 ? args[3] : await mkdtemp(path.join(outputRoot, 'local-'));
  if (args.length === 4) await mkdir(output);
  const stage = path.join(output, 'workspace');
  const report = { status: 'FAIL', cases: [], auth: 'NOT RUN: real email and OAuth', output };
  try {
    await mkdir(stage);
    report.isolation = await prepareFullApp(stage);
    const { chromium } = await import('@playwright/test');
    const browserCache = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
    const environment = childEnvironment(process.env, stage, 'production-build', browserCache);
    const log = createWriteStream(path.join(output, 'build.log'));
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'],
        { cwd: stage, env: environment, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
      child.once('error', reject); child.once('close', resolve);
    });
    await new Promise(resolve => log.end(resolve));
    assert.equal(code, 0, 'Full-app isolated production build failed; inspect build.log');
    report.build = 'PASS';
    const runner = await import(pathToFileURL(path.join(stage, 'scripts/krw-usd-rc-rehearsal.mjs')).href);
    const result = await runner.rehearseReliabilityFullApp(['--execute-local', '--pg-bin', args[1]], output, stage, browserCache);
    Object.assign(report, result);
    assert.equal(result.status, 'PASS', result.testFailure ?? 'Actual Next app browser journey failed');
  } catch (error) {
    report.status = 'FAIL'; report.error = String(error.message).slice(0, 600);
  }
  if (report.isolation) {
    const originalIdentity = await readFile(path.join(ROOT, 'src/lib/auth/current-session-subject.ts'));
    assert.equal(createHash('sha256').update(originalIdentity).digest('hex'), report.isolation.sourceIdentitySha256, 'Original production auth source changed during rehearsal');
    assert.ok(!originalIdentity.toString().includes('cairn_fullapp_identity'), 'Production identity source cannot contain the test fixture');
  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status:report.status,report:path.join(output,'report.json'),error:report.error}));
  return report;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(report => { process.exitCode = report.status === 'PASS' ? 0 : 1; });
}
