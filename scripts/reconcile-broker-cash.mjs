import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { reconcileBrokerCash } from './lib/broker-cash-reconciliation.ts';

// Deliberately no DB, env loader, provider or writer dependency. Personal evidence
// and full output must stay in the checkout's ignored .vercel directory.
const [inputArg, outputArg, ...extra] = process.argv.slice(2);
if (!inputArg || !outputArg || extra.length) throw new Error('usage: node --experimental-strip-types scripts/reconcile-broker-cash.mjs .vercel/input.json .vercel/output.json');
const root = realpathSync(resolve('.vercel'));
function privatePath(arg, existing) {
  const path = resolve(arg), actual = existing ? realpathSync(path) : resolve(realpathSync(dirname(path)), path.split(/[\\/]/).at(-1));
  const rel = relative(root, actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('private_evidence_path_required');
  return actual;
}
const input = privatePath(inputArg, true), output = privatePath(outputArg, existsSync(resolve(outputArg)));
if (input === output) throw new Error('cannot_overwrite_source_evidence');
const source = readFileSync(input);
const report = reconcileBrokerCash(JSON.parse(source.toString('utf8')));
writeFileSync(output, JSON.stringify({ sourceHash: createHash('sha256').update(source).digest('hex'), ...report }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ status: 'cash_reconciled_only', cashRows: report.cashRowCount, matchedTrades: report.matched.length, duplicateRows: report.duplicateRows, unlinkedTrades: report.unlinkedTradeRows.length, nativeReplayReady: false }));
