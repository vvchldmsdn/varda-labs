import { readFileSync, writeFileSync } from 'node:fs';
if (process.env.CI !== 'true') throw Error('Isolated CI only');
function edit(path, before, after) {
  const source = readFileSync(path,'utf8');
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw Error('Ambiguous refinement: '+path+' '+before.slice(0,60));
  writeFileSync(path,source.replace(before,after));
}
edit('src/lib/trade-record-intent.ts', 'action: (hint.action ?? "deposit") as TradeRecordAction | "deposit"', 'action: ((!hint.accountId || account) ? hint.action ?? "deposit" : "deposit") as TradeRecordAction | "deposit"');
edit('src/components/trade-record-links.tsx', '{ variant = "panel", onNavigate }: { variant?: "topbar" | "panel" | "menu"; onNavigate?: () => void }', '{ variant = "panel", accountId, onNavigate }: { variant?: "topbar" | "panel" | "menu"; accountId?: string; onNavigate?: () => void }');
edit('src/components/trade-record-links.tsx', 'tradeRecordHref({ action: "buy" })', 'tradeRecordHref({ accountId, action: "buy" })');
edit('src/components/trade-record-links.tsx', 'tradeRecordHref({ action: "sell" })', 'tradeRecordHref({ accountId, action: "sell" })');
edit('src/components/app-navigation.tsx', '<TradeRecordLinks variant="topbar" />', '<TradeRecordLinks variant="topbar" accountId={scope?.startsWith("account:") ? scope.slice(8) : undefined} />');
edit('src/components/app-navigation.tsx', '<TradeRecordLinks variant="menu" onNavigate=', '<TradeRecordLinks variant="menu" accountId={scope?.startsWith("account:") ? scope.slice(8) : undefined} onNavigate=');
edit('src/app/portfolio/manage/page.tsx', '<PortfolioText ko={title} /><small><PortfolioText ko={description} /></small>', '<PortfolioText ko={title} en={href === "/portfolio/ledger" ? "Trade & cash records" : undefined} /><small><PortfolioText ko={description} en={href === "/portfolio/ledger" ? "Record executed trades and cash movements." : undefined} /></small>');
// These two existing tests assumed Windows separators. Keep every security
// assertion; only make the expected repository-local path native-platform.
edit('tests/identity-bootstrap-claim-migration-cli.test.mjs', 'import assert from "node:assert/strict";', 'import assert from "node:assert/strict";\nimport { join as joinPath } from "node:path";');
edit('tests/identity-bootstrap-claim-migration-cli.test.mjs', 'assert.equal(path, "C:\\\\repo\\\\.env.local");', 'assert.equal(path, joinPath("C:\\\\repo", ".env.local"));');
edit('tests/identity-bootstrap-claim-handoff-rehearsal.test.mjs', 'import assert from "node:assert/strict";', 'import assert from "node:assert/strict";\nimport { resolve as resolvePath } from "node:path";');
edit('tests/identity-bootstrap-claim-handoff-rehearsal.test.mjs', 'result.envFile,\n      "C:\\\\repo\\\\.env.preview-rehearsal.local",', 'result.envFile,\n      resolvePath("C:\\\\repo", ".env.preview-rehearsal.local"),');
edit('scripts/verify-trade-entry-hotfix.mjs', "run('node', ['--no-warnings','tests/run.mjs'], 'full-tests');", "run('node', ['--no-warnings','--test','--test-isolation=none','tests/trade-record-intent.test.mjs','tests/native-legacy-lifecycle.test.mjs','tests/identity-bootstrap-claim-migration-cli.test.mjs','tests/identity-bootstrap-claim-handoff-rehearsal.test.mjs'], 'focused-tests');");
edit('scripts/verify-trade-entry-hotfix.mjs', "} finally {\n  await browser?.close();", "} catch (error) {\n  const failedPage = browser?.contexts().flatMap(context => context.pages()).at(-1);\n  if (failedPage) { await failedPage.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{}); writeFileSync(`${out}/browser-failure.txt`, await failedPage.locator('body').innerText().catch(()=>'')); }\n  throw error;\n} finally {\n  await browser?.close();");
edit('scripts/verify-trade-entry-hotfix.mjs', "console.log('Verification complete; temporary harness removed.');", "run('node', ['--no-warnings','tests/run.mjs'], 'full-tests');\nconsole.log('Verification complete; temporary harness removed.');");
console.log('Retained explicit invalid-account guards, scoped navigation, translated record entry and portable environment-path tests.');
