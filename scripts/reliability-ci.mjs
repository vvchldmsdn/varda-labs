import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const JOBS = ['lint-type', 'unit-tests', 'production-build', 'postgres-integration', 'browser-journeys'];
export const SOURCE_DIRECTORIES = ['.agents', '.github', 'docs', 'drizzle', 'e2e', 'operator-inputs', 'public', 'scripts', 'src', 'tests'];
export const SOURCE_FILES = ['AGENTS.md', 'CLAUDE.md', 'README.md', '.gitignore', '.gitattributes', '.vercelignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'eslint.config.mjs', 'postcss.config.mjs', 'playwright.config.ts', 'drizzle.config.ts', 'vercel.json'];
const DEAD_DATABASE = 'postgresql://synthetic:synthetic@127.0.0.1:1/isolated_ci';

export function parseOptions(args) {
  if (args.length === 1 && args[0] === '--validate-only') return { validateOnly: true };
  assert.equal(args[0], '--job', 'Use --job <job|all> [--pg-bin <absolute directory>] or --validate-only');
  assert.ok([...JOBS, 'all'].includes(args[1]), 'Unknown CI job');
  const needsPg = ['postgres-integration', 'browser-journeys', 'all'].includes(args[1]);
  assert.equal(args.length, needsPg ? 4 : 2, 'PostgreSQL jobs require only --pg-bin, never a database URL');
  if (needsPg) {
    assert.equal(args[2], '--pg-bin');
    assert.ok(path.isAbsolute(args[3]), 'PostgreSQL binaries must have an absolute directory');
  }
  return { job: args[1], pgBin: needsPg ? args[3] : undefined };
}

export function childEnvironment(input, stage, job, browserCache) {
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'COMSPEC', 'PATHEXT']);
  const result = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key.toUpperCase())));
  const home = path.join(stage, 'output', 'isolated-home');
  return {
    ...result, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'), APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'local'),
    CI: 'true', NEXT_TELEMETRY_DISABLED: '1', TZ: 'UTC',
    DATABASE_URL: DEAD_DATABASE, DATABASE_URL_UNPOOLED: DEAD_DATABASE, TENANT_DATABASE_URL: DEAD_DATABASE,
    VARDA_AUTH_NAVER_ENABLED: 'false', VARDA_AUTH_GITHUB_ENABLED: 'false', VARDA_AUTH_EMAIL_PASSWORD_ENABLED: 'false',
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(stage, 'scripts/reliability-ci-network.mjs')).href}`,
    CAIRN_CI_ALLOW_FONT_NETWORK: job === 'production-build' ? '1' : '0',
    ...(browserCache ? { PLAYWRIGHT_BROWSERS_PATH: browserCache } : {}),
  };
}

export async function stageSource(root, stage) {
  const sourceRoot = await realpath(root);
  for (const name of [...SOURCE_DIRECTORIES, ...SOURCE_FILES]) {
    await cp(path.join(sourceRoot, name), path.join(stage, name), {
      recursive: true, errorOnExist: true, force: false,
      filter: async candidate => {
        const base = path.basename(candidate);
        if (base.startsWith('.env') || ['node_modules', '.git', '.vercel', '.next', '.worktrees', 'output'].includes(base)) return false;
        assert.ok(!(await lstat(candidate)).isSymbolicLink(), 'Source symlink rejected; it could escape the reviewed checkout');
        return true;
      },
    });
  }
  // Installed dependencies are reused, never copied from a production deployment.
  await symlink(await realpath(path.join(sourceRoot, 'node_modules')), path.join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await mkdir(path.join(stage, 'output', 'isolated-home'), { recursive: true });
}

async function sourceFingerprint(stage) {
  const digest = createHash('sha256');
  async function visit(relative) {
    const file = path.join(stage, relative);
    const stat = await lstat(file);
    if (stat.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(path.join(relative, name));
    } else {
      digest.update(relative.replaceAll(path.sep, '/')).update('\0');
      digest.update(createHash('sha256').update(await readFile(file)).digest('hex')).update('\n');
    }
  }
  for (const name of [...SOURCE_DIRECTORIES, ...SOURCE_FILES].sort()) await visit(name);
  return digest.digest('hex');
}

async function runNode({ stage, output, environment, report }, name, args) {
  const started = Date.now();
  const logfile = path.join(output, 'logs', `${name}.log`);
  const log = createWriteStream(logfile, { flags: 'wx' });
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: stage, env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once('error', error => resolve({ code: null, errorCode: error.code ?? 'SPAWN_FAILED' }));
    child.once('close', code => resolve({ code }));
  });
  await new Promise(resolve => log.end(resolve));
  const text = await readFile(logfile, 'utf8');
  report.steps.push({ name, status: result.code === 0 ? 'PASS' : 'FAIL', exitCode: result.code, errorCode: result.errorCode,
    elapsedMs: Date.now() - started, log: `logs/${name}.log`, sha256: createHash('sha256').update(text).digest('hex') });
  console.log(`${name}: ${result.code === 0 ? 'PASS' : 'FAIL'} (${Date.now() - started} ms)`);
  if (result.code !== 0) {
    console.error(text.split(/\r?\n/).slice(-35).join('\n'));
    throw new Error(`CI step failed: ${name}`);
  }
}

async function executeJob(root, job, pgBin) {
  const outputRoot = path.join(root, 'output', 'reliability-ci');
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(path.join(outputRoot, `${job}-`));
  const stage = path.join(output, 'workspace');
  await mkdir(path.join(output, 'logs')); await mkdir(stage);
  const report = { status: 'FAIL', job, node: process.version, platform: process.platform, startedAt: new Date().toISOString(),
    isolation: { sourceCopy: true, parentEnvironmentExcluded: true, envFilesExcluded: true, productionCredentials: false, providerRequests: false }, steps: [] };
  try {
    // Resolve Playwright's installed binary cache before replacing HOME. This path
    // contains browser executables, never cookies or authentication storage state.
    let browserCache;
    if (job === 'browser-journeys') {
      const { chromium } = await import('@playwright/test');
      browserCache = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
    }
    await stageSource(root, stage);
    report.sourceSha256 = await sourceFingerprint(stage);
    const environment = childEnvironment(process.env, stage, job, browserCache);
    const context = { stage, output, environment, report };
    await runNode(context, 'isolation-checks', ['--test', 'scripts/reliability-ci-checks.mjs']);
    if (job === 'lint-type') {
      await runNode(context, 'lint', ['node_modules/eslint/bin/eslint.js', '.']);
      await runNode(context, 'route-types', ['node_modules/next/dist/bin/next', 'typegen']);
      await runNode(context, 'typescript', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']);
    } else if (job === 'unit-tests') {
      await runNode(context, 'full-tests', ['--no-warnings', 'tests/run.mjs']);
    } else if (job === 'production-build') {
      await runNode(context, 'production-build', ['node_modules/next/dist/bin/next', 'build', '--webpack']);
    } else if (job === 'postgres-integration') {
      await runNode(context, 'postgres-integration', ['scripts/reliability-ci-postgres.mjs', '--pg-bin', pgBin, '--report', path.join(output, 'postgres-report.json')]);
      const result = JSON.parse(await readFile(path.join(output, 'postgres-report.json'), 'utf8'));
      assert.equal(result.status, 'PASS', 'A missing or NOT RUN real PostgreSQL result cannot pass CI');
    } else if (job === 'browser-journeys') {
      await runNode(context, 'browser-journeys', ['scripts/reliability-browser.mjs', '--output-dir', path.join(output, 'browser'), '--pg-bin', pgBin]);
      const result = JSON.parse(await readFile(path.join(output, 'browser', 'report.json'), 'utf8'));
      assert.equal(result.status, 'PASS', 'A skipped browser journey cannot pass CI');
      await runNode(context, 'fullapp-journeys', ['scripts/reliability-fullapp.mjs', '--pg-bin', pgBin, '--output-dir', path.join(output, 'fullapp')]);
      const fullApp = JSON.parse(await readFile(path.join(output, 'fullapp', 'report.json'), 'utf8'));
      assert.equal(fullApp.status, 'PASS', 'Missing or skipped actual Next app journeys cannot pass CI');
      assert.equal(fullApp.build, 'PASS', 'Full-app journeys require the production build');
      assert.ok(fullApp.cases.some(row => row.name === 'fullapp-native-home-quick-buy-sell-clock-skew-real-router-refresh' && row.status === 'PASS'));
    }
    report.status = 'PASS';
  } catch (error) {
    report.errorCode = error.code ?? (error.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'CI_FAILED');
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Evidence: ${path.relative(root, path.join(output, 'report.json'))}`);
  }
  return report;
}

export async function main(args) {
  const options = parseOptions(args);
  if (options.validateOnly) return { status: 'NOT RUN', validation: 'PASS', jobs: JOBS, reason: 'No process, network, database, or generated files' };
  const reports = [];
  for (const job of options.job === 'all' ? JOBS : [options.job]) reports.push(await executeJob(ROOT, job, options.pgBin));
  return { status: 'PASS', jobs: reports.map(({ job, status }) => ({ job, status })) };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(report => console.log(JSON.stringify(report))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
