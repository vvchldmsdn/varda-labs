import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
assert.equal(args.length, 4);
assert.equal(args[0], '--pg-bin'); assert.ok(path.isAbsolute(args[1]));
assert.equal(args[2], '--report'); assert.ok(path.isAbsolute(args[3]));
const { rehearseReliability } = await import('./krw-usd-rc-rehearsal.mjs');
assert.equal(typeof rehearseReliability, 'function', 'The full empty/upgrade/process reliability rehearsal is required');
const report = await rehearseReliability(['--execute-local', '--pg-bin', args[1]]);
await writeFile(args[3], `${JSON.stringify(report, null, 2)}\n`);
assert.equal(report.status, 'PASS', 'Real PostgreSQL unavailable or failing is not a passing CI job');
console.log('Empty schema, upgrade, and reliability PostgreSQL rehearsal: PASS');
