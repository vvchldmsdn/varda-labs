import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
if (branch !== 'codex/trade-entry-hotfix-20260924' || process.env.CI !== 'true') throw Error('Run only in the isolated hotfix branch CI');
if (existsSync('src/lib/trade-record-intent.ts')) { console.log('Trade-entry patch already materialized'); process.exit(0); }
function put(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function edit(path, before, after) {
  const text = readFileSync(path, 'utf8');
  if (text.split(before).length !== 2) throw Error(`Expected exactly one patch site in ${path}: ${before.slice(0, 80)}`);
  writeFileSync(path, text.replace(before, after));
}

put('src/lib/trade-record-intent.ts', `export type TradeRecordAction = "buy" | "sell" | "cost_basis";
export type TradeRecordHint = { accountId?: string; assetId?: string; action?: string };
type SelectableAccount = { id: string; active?: boolean; assets: readonly { id: string }[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeTradeRecordHint(input: { accountId?: unknown; assetId?: unknown; action?: unknown }): TradeRecordHint {
  return {
    accountId: typeof input.accountId === "string" && UUID.test(input.accountId) ? input.accountId : undefined,
    assetId: typeof input.assetId === "string" && UUID.test(input.assetId) ? input.assetId : undefined,
    action: input.action === "buy" || input.action === "sell" || input.action === "cost_basis" ? input.action : undefined,
  };
}
/** Navigation hints never establish account ownership; resolve only against the authenticated account list. */
export function resolveTradeRecordSelection(accounts: readonly SelectableAccount[], input: TradeRecordHint) {
  const hint = normalizeTradeRecordHint(input);
  const account = accounts.find(row => row.active !== false && row.id === hint.accountId);
  const asset = account?.assets.find(row => row.id === hint.assetId);
  return { accountId: account?.id ?? "", assetId: asset?.id ?? "", action: (hint.action ?? "deposit") as TradeRecordAction | "deposit" };
}
export function tradeRecordHref(input: TradeRecordHint = {}) {
  const hint = normalizeTradeRecordHint(input), params = new URLSearchParams();
  if (hint.accountId) params.set("accountId", hint.accountId);
  if (hint.assetId && hint.accountId) params.set("assetId", hint.assetId);
  if (hint.action) params.set("action", hint.action);
  return "/portfolio/ledger" + (params.size ? "?" + params.toString() : "");
}
/** Opening balances do not complete the requested trade; retain only its holding selection. */
export function fieldsAfterLedgerSave(previous: Record<string, string>, wasOpening: boolean, at: string): Record<string, string> {
  return { currency: previous.currency ?? "USD", at, assetType: "etf", ...(wasOpening && previous.assetId ? { assetId: previous.assetId } : {}) };
}
`);

put('src/components/trade-record-links.tsx', `"use client";
import Link from "next/link";
import { useI18n } from "@/components/i18n/locale-provider";
import { tradeRecordHref } from "@/lib/trade-record-intent";
import styles from "./trade-record-links.module.css";

export function TradeRecordLinks({ variant = "panel", onNavigate }: { variant?: "topbar" | "panel" | "menu"; onNavigate?: () => void }) {
  const { t } = useI18n();
  return <div className={styles[variant]} role="group" aria-label={t("매매 기록", "Trade records")}>
    <Link className={styles.link} href={tradeRecordHref({ action: "buy" })} prefetch={false} onClick={onNavigate}>{t("매수 기록", "Record buy")}</Link>
    <Link className={styles.link} href={tradeRecordHref({ action: "sell" })} prefetch={false} onClick={onNavigate}>{t("매도 기록", "Record sell")}</Link>
  </div>;
}
`);
put('src/components/trade-record-links.module.css', `.topbar,.panel,.menu{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.link{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 13px;border:1px solid var(--line);border-radius:8px;color:var(--ink);background:var(--paper);font-size:12px;font-weight:550;line-height:1.3;text-decoration:none;white-space:nowrap}.link:hover{border-color:var(--ink);background:var(--wash)}.link:focus-visible{outline:2px solid var(--brand);outline-offset:3px}.panel{margin-block:16px}.menu{padding:16px 0}.menu .link{flex:1;min-height:44px}.topbar{flex-wrap:nowrap}.topbar .link{min-height:36px;padding:8px 10px}@media(max-width:1100px){.topbar .link{padding-inline:8px;font-size:11px}}@media(max-width:760px){.topbar{display:none}}
`);

edit('src/components/app-navigation.tsx', 'import { BrandLogo }', 'import { TradeRecordLinks } from "@/components/trade-record-links";\nimport { BrandLogo }');
edit('src/components/app-navigation.tsx', '          <LanguageSwitch />', '          <LanguageSwitch />\n          {!preview ? <TradeRecordLinks variant="topbar" /> : null}');
edit('src/components/app-navigation.tsx', '          {links}\n          <Link className="varda-menu-account"', '          {links}\n          {!preview ? <TradeRecordLinks variant="menu" onNavigate={() => menuRef.current?.close()} /> : null}\n          <Link className="varda-menu-account"');

edit('src/app/portfolio/manage/page.tsx', 'import { isActivityAdmin }', 'import { TradeRecordLinks } from "@/components/trade-record-links";\nimport { isActivityAdmin }');
edit('src/app/portfolio/manage/page.tsx', '  { title: "기록", links: [', '  { title: "기록", links: [\n    { href: "/portfolio/ledger", title: "매매·현금 기록", description: "체결한 매매와 입출금을 기록합니다.", icon: ListChecks },');
edit('src/app/portfolio/manage/page.tsx', '          <Link href="/portfolio/holdings/new" className="varda-action">', '          <TradeRecordLinks />\n          <Link href="/portfolio/holdings/new" className="varda-action">');

put('src/app/portfolio/ledger/page.tsx', `import { redirect } from "next/navigation";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { NativeLedgerView } from "@/components/native-ledger-view";
import { normalizeTradeRecordHint, tradeRecordHref } from "@/lib/trade-record-intent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trade records | CAIRN LABS", robots: { index: false, follow: false } };
export default async function NativeLedgerPage({ searchParams }: { searchParams: Promise<{ accountId?: string | string[]; assetId?: string | string[]; action?: string | string[] }> }) {
  const initialSelection = normalizeTradeRecordHint(await searchParams);
  const returnTo = tradeRecordHref(initialSelection);
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) redirect("/auth/sign-in?returnTo=" + encodeURIComponent(returnTo));
  return <NativeLedgerView key={returnTo} initialSelection={initialSelection} />;
}
`);

edit('src/components/native-ledger-view.tsx', 'import Link from "next/link";', 'import Link from "next/link";\nimport { fieldsAfterLedgerSave, resolveTradeRecordSelection } from "@/lib/trade-record-intent";');
edit('src/components/native-ledger-view.tsx', `  const account = accounts.find(row => row.active !== false && row.id === hint.accountId);
  const asset = account?.assets.find(row => row.id === hint.assetId);
  return { accountId: account?.id ?? "", assetId: asset?.id ?? "", action: account && ["buy", "sell", "cost_basis"].includes(hint.action ?? "") ? hint.action as EventKind : "deposit" as EventKind };`, `  return resolveTradeRecordSelection(accounts, hint);`);
edit('src/components/native-ledger-view.tsx', '  const [confirmed, setConfirmed]', '  const [savedOpening, setSavedOpening] = useState(false);\n  const [confirmed, setConfirmed]');
edit('src/components/native-ledger-view.tsx', 'setSuccess(true); setConfirmed(false); setFields(previous => ({ currency: previous.currency ?? "USD", at: localNow(), assetType: "etf" }));', 'setSuccess(true); setSavedOpening(!account.state); setConfirmed(false); setFields(previous => fieldsAfterLedgerSave(previous, !account.state, localNow()));');
edit('src/components/native-ledger-view.tsx', '{t("보유 정보와 현금", "Holdings & cash")}</h1>', '{t("매매·현금 기록", "Trades & cash")}</h1>');
edit('src/components/native-ledger-view.tsx', '    {loading ? <p role="status"', `    <p className={styles.note}>{t("증권사에서 체결한 거래를 기록합니다.", "Record trades already executed at your broker.")}</p>
    <div className={styles.tradeKinds} role="group" aria-label={t("매매 유형", "Trade type")}>
      {(["buy", "sell"] as const).map(action => <button key={action} type="button" aria-pressed={kind === action} disabled={busy || loading || !data?.canWrite || signedOut || conflict} onClick={() => { setKind(action); pending.current = null; setError(""); setSuccess(false); }}>{action === "buy" ? t("매수 기록", "Record buy") : t("매도 기록", "Record sell")}</button>)}
    </div>
    {loading ? <p role="status"`);
edit('src/components/native-ledger-view.tsx', '{t("기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.", "Recorded. Your updated holdings are available on Home.")}', '{savedOpening ? t("잔액을 확인했어요. 선택한 거래를 이어서 기록하세요.", "Balances confirmed. Continue with your selected transaction.") : t("기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.", "Recorded. Your updated holdings are available on Home.")}');
edit('src/components/native-ledger-view.tsx', 'account.state ? t("기록하기", "Save record") : t("이 잔액으로 시작", "Start with these balances")', 'account.state ? kind === "buy" ? t("매수 기록 저장", "Save buy record") : kind === "sell" ? t("매도 기록 저장", "Save sell record") : t("기록하기", "Save record") : t("잔액 확인 후 계속", "Confirm balances and continue")');
writeFileSync('src/components/native-ledger-view.module.css', readFileSync('src/components/native-ledger-view.module.css','utf8') + '\n.tradeKinds{display:flex;gap:10px;margin:20px 0;flex-wrap:wrap}.tradeKinds button{min-height:44px;min-width:116px;padding:10px 20px;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:8px;font:inherit;font-size:14px;cursor:pointer}.tradeKinds button[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}.tradeKinds button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:760px){.tradeKinds button{flex:1}}\n');

put('tests/trade-record-intent.test.mjs', `import assert from "node:assert/strict";
import { it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
const [m] = await importWithPorts(["src/lib/trade-record-intent.ts"], {});
const accountId = "11111111-1111-4111-8111-111111111111", assetId = "44444444-4444-4444-8444-444444444444";
const accounts = [{ id: accountId, assets: [{ id: assetId }] }];
it("keeps a generic buy or sell intent without a preselected account", () => {
  for (const action of ["buy", "sell"]) assert.deepEqual(m.resolveTradeRecordSelection(accounts, { action }), { accountId: "", assetId: "", action });
});
it("resolves holding hints only within an authenticated active account", () => {
  assert.deepEqual(m.resolveTradeRecordSelection(accounts, { accountId, assetId, action: "sell" }), { accountId, assetId, action: "sell" });
  assert.equal(m.resolveTradeRecordSelection([{ ...accounts[0], active: false }], { accountId, assetId, action: "sell" }).assetId, "");
  assert.equal(m.resolveTradeRecordSelection(accounts, { accountId: "22222222-2222-4222-8222-222222222222", assetId, action: "buy" }).assetId, "");
});
it("preserves only safe internal navigation fields through authentication", () => {
  assert.equal(m.tradeRecordHref({ accountId, assetId, action: "sell" }), "/portfolio/ledger?accountId=" + accountId + "&assetId=" + assetId + "&action=sell");
  assert.equal(m.tradeRecordHref({ accountId: "https://evil.invalid", assetId, action: "https://evil.invalid" }), "/portfolio/ledger");
  assert.equal(m.normalizeTradeRecordHint({ action: ["buy", "sell"] }).action, undefined);
});
it("continues the intended holding after opening balances but clears transaction amounts", () => {
  const fields = { assetId, currency: "USD", quantity: "2", price: "100", cashUsd: "1000", fee: "1" };
  assert.deepEqual(m.fieldsAfterLedgerSave(fields, true, "time"), { assetId, currency: "USD", at: "time", assetType: "etf" });
  assert.deepEqual(m.fieldsAfterLedgerSave(fields, false, "time"), { currency: "USD", at: "time", assetType: "etf" });
});
`);
writeFileSync('tests/run.mjs', readFileSync('tests/run.mjs','utf8') + '\nimport "./trade-record-intent.test.mjs";\n');
console.log('Materialized navigation, trade selection, safe return path, opening continuity, and four behavior tests. No writer/schema changes.');
