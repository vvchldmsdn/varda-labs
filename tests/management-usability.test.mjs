import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { accountActionMessageKo, accountTypeLabel } from "../src/lib/i18n/account-management-copy.ts";

describe("holding and account management usability", () => {
  it("renders partial-read warnings in both languages and keeps blocked holdings out of the list", async () => {
    let locale = "ko", signedIn = true;
    const tenantContext = { appUserId: "session-user" };
    const selectedScope = { key: "account:first", label: "My account" };
    const holding = { holdingId: "a", archivedAt: null };
    let result = { state: "partial", holdings: [holding], excludedHoldingCount: 1 };
    const reads = [], lists = [];
    const [component] = await importUiWithPorts(["src/app/portfolio/holdings/page.tsx"], {
      "@/lib/i18n/server": { localizedMetadata: () => ({}) },
      "@/components/i18n/localized-text": { T: ({ ko, en }) => locale === "ko" ? ko : en },
      "@/components/i18n/management-text": { ManagementText: ({ children }) => children },
      "@/components/holdings-management-list": { HoldingsManagementList: props => { lists.push(props); return createElement("div", { "data-visible-holdings": props.holdings.length }); } },
      "@/components/secondary-page-header": { SecondaryPageHeader: () => null },
      "@/components/portfolio-analysis-scope-tabs": { PortfolioAnalysisScopeTabs: () => null },
      "next/link": { default: ({ href, children }) => createElement("a", { href }, children) },
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => signedIn ? { ok: true, tenantContext } : { ok: false } },
      "@/lib/snapshots/market-calendar": { resolveSnapshotCycle: () => ({ snapshotDate: "2026-09-09" }) },
      "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async input => { reads.push(input); return { state: "ready", resolution: { state: "resolved", scope: selectedScope }, catalog: { scopes: [selectedScope] } }; } },
      "@/db/queries/tenant-holdings": { getReadOnlyTenantHoldings: async input => { reads.push(input); return result; } },
      "@/db/queries/holding-analysis-data-readiness": { getReadOnlyTenantHoldingAnalysisDataReadiness: async input => { reads.push(input); return { state: "ready", entries: [] }; } },
    });
    const render = async () => renderToStaticMarkup(await component.default({ searchParams: Promise.resolve({ scope: selectedScope.key }) }));
    const ko = await render();
    assert.match(ko, /일부 종목 정보가 불완전해 목록에서 제외했습니다/);
    assert.match(ko, /전체 평가액을 합산하지 않습니다/);
    assert.equal(lists.at(-1).holdings[0], holding);
    assert.ok(reads.every(input => input.tenantContext === tenantContext), "all read ports receive the resolved session context");
    assert.ok(reads.some(input => input.serviceDate === "2026-09-09" && input.scope === selectedScope));
    locale = "en";
    assert.match(await render(), /Some incomplete holdings are excluded\. This list is not a complete portfolio valuation/);
    const visibleCalls = lists.length;
    result = { state: "integrity_error", holdings: [holding] };
    assert.doesNotMatch(await render(), /data-visible-holdings/);
    assert.equal(lists.length, visibleCalls);
    const authorizedReadCount = reads.length;
    signedIn = false;
    assert.doesNotMatch(await render(), /data-visible-holdings/);
    assert.equal(reads.length, authorizedReadCount, "unauthenticated requests must not call the tenant read ports");
  });

  it("keeps each holding's edit/restore identity and null cost without a desktop-only table", async () => {
    let locale = "ko";
    const corrections = [], archives = [], restores = [], analyses = [];
    const marker = (name, captured) => function FormMarker(props) { captured.push(props); return createElement("div", { [`data-${name}`]: props.holdingId }); };
    const [component] = await importUiWithPorts(["src/components/holdings-management-list.tsx"], {
      "@/components/i18n/localized-text": { T: ({ ko, en }) => locale === "ko" ? ko : en },
      "@/components/holding-state-correction-form": { HoldingStateCorrectionForm: marker("edit", corrections) },
      "@/components/holding-lifecycle-forms": { HoldingArchiveForm: marker("archive", archives), HoldingRestoreForm: marker("restore", restores) },
      "@/components/holding-analysis-data-form": { HoldingAnalysisDataForm: marker("analysis", analyses) },
      "@/components/manual-krx-gold-price-form": { ManualKrxGoldPriceForm: () => null },
    });
    const base = { accountCode: "first", accountName: "My account", name: "Same-name holding", ticker: "AAPL", assetType: "stock", market: "us", currency: "USD", quantity: "12345678901234.123456", averageCost: null, currentPrice: "230.1200", priceSource: "kis_overseas_price:NAS", priceStatus: "ok", priceAsOf: "2026-09-10T03:00:00Z", archivedAt: null, updatedAt: "2026-09-10T03:01:00.123456Z" };
    const holdings = [{ ...base, holdingId: "a" }, { ...base, holdingId: "b", accountCode: "second", accountName: "Other account", averageCost: "100.1234" }, { ...base, holdingId: "c", archivedAt: "2026-09-10T03:02:00Z" }];
    const original = structuredClone(holdings);
    const readiness = { holdingId: "a", state: "ready" };
    const view = () => renderToStaticMarkup(createElement(component.HoldingsManagementList, { holdings, analysisDataByHolding: new Map([["a", readiness]]) }));
    const ko = view();
    assert.doesNotMatch(ko, /<table|min-w-\[1320px\]|Owner-scoped|Not recorded/);
    assert.match(ko, /미등록/);
    assert.match(ko, /12,345,678,901,234\.123456/, "displaying quantity must not round stored decimal precision through Number");
    assert.match(ko, /100\.1234 USD/);
    assert.match(ko, /2026-09-10 12:00 KST/);
    assert.match(ko, /<details/);
    assert.deepEqual(corrections.map(row => [row.holdingId, row.updatedAt, row.averageCost]), [["a", base.updatedAt, null], ["b", base.updatedAt, "100.1234"]]);
    assert.deepEqual(archives.map(row => row.holdingId), ["a", "b"]);
    assert.deepEqual(restores.map(row => [row.holdingId, row.updatedAt]), [["c", base.updatedAt]]);
    assert.deepEqual(analyses.map(row => row.readiness), [readiness, null]);
    locale = "en";
    const en = view();
    assert.match(en, /Not recorded/);
    assert.match(en, /You can add it later/);
    assert.match(en, /Stored price/);
    assert.doesNotMatch(en, /미등록|보유 수량|가격 확인 시각/);
    assert.deepEqual(holdings, original);
  });

  it("localizes account forms while preserving action, version, confirmation and pending controls", async () => {
    let locale = "ko", pending = false;
    const calls = [];
    const createAccount = () => {}, updateAccount = () => {}, archiveAccount = () => {}, restoreAccount = () => {};
    const [component] = await importUiWithPorts(["src/components/account-management.tsx"], {
      react: { useActionState: action => { calls.push(action); return [{ status: "success", message: "Account created." }, () => {}, pending]; }, useEffect: () => {}, useRef: () => ({ current: null }) },
      "@/components/i18n/locale-provider": { useI18n: () => ({ t: (ko, en) => locale === "ko" ? ko : en ?? ko }) },
      "@/app/portfolio/accounts/actions": { createAccount, updateAccount, archiveAccount, restoreAccount },
    });
    const create = () => renderToStaticMarkup(createElement(component.AccountCreateForm));
    const ko = create();
    assert.match(ko, /계좌 이름/);
    assert.match(ko, /계좌를 만들었습니다/);
    assert.doesNotMatch(ko, /Account name|Create account|Account created/);
    locale = "en";
    assert.match(create(), /Account name/);
    const account = { id: "account-id", name: "My unchanged name", accountType: "investment", currency: "KRW", activeHoldingCount: 1, openGroupReferenceCount: 1, updatedAt: "2026-09-10T03:00:00.123Z" };
    const editor = renderToStaticMarkup(createElement(component.AccountEditor, { account }));
    assert.match(editor, /name="accountId"[^>]*value="account-id"/);
    assert.match(editor, /name="expectedUpdatedAt"[^>]*value="2026-09-10T03:00:00\.123Z"/);
    assert.match(editor, /disabled=""[^>]*name="archiveConfirmed"/);
    assert.match(editor, /Linked scopes/);
    assert.doesNotMatch(editor, /Group references/);
    locale = "ko";
    const importedAccount = renderToStaticMarkup(createElement(component.AccountEditor, { account: { ...account, accountType: "brokerage" } }));
    assert.match(importedAccount, /증권 계좌/);
    assert.doesNotMatch(importedAccount, /brokerage/);
    pending = true;
    assert.match(create(), /disabled=""/);
    assert.ok(calls.includes(createAccount) && calls.includes(updateAccount) && calls.includes(archiveAccount));
  });

  it("translates validated account outcomes without changing unknown provider or user text", () => {
    assert.equal(accountActionMessageKo("Account created."), "계좌를 만들었습니다.");
    assert.match(accountActionMessageKo("Another account change completed first. Refresh the page."), /새로고침/);
    assert.match(accountActionMessageKo("Move or close active holdings before archiving this account."), /보유종목/);
    assert.equal(accountActionMessageKo("My own label"), "My own label");
    assert.equal(accountActionMessageKo("toString"), "toString");
    assert.deepEqual(accountTypeLabel("cash"), ["현금 계좌", "Cash account"]);
    assert.deepEqual(accountTypeLabel("isa"), ["ISA 계좌", "ISA account"]);
    assert.deepEqual(accountTypeLabel("irp"), ["IRP 계좌", "IRP account"]);
    assert.deepEqual(accountTypeLabel("Custom type"), ["Custom type", "Custom type"]);
    assert.deepEqual(accountTypeLabel("toString"), ["toString", "toString"]);
  });
});
