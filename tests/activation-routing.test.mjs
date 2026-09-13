import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const tenant = { ownerUserId: "owner-a", role: "user" };
const input = { currency: "KRW", rows: [{ name: "My asset", value: 3000000, instrumentId: null }] };
const saved = { id: "personal-id", input, createdAt: "2026-09-13T00:00:00Z" };
const redirect = url => { throw new Error(`redirect:${url}`); };
const named = name => Object.defineProperty(() => null, "name", { value: name });

describe("state-based activation routing", () => {
  it("sends entered portfolios to activation; direct signups only need names and amounts", async () => {
    let intent, source, resolution = { ok: false, failure: { code: "identity_unlinked" } }, drafts = [], hasAssetHistory = false;
    const [page] = await importUiWithPorts(["src/app/portfolio/onboarding/page.tsx"], {
      "next/navigation": { redirect },
      "next/link": { default: named("Link") },
      "@/lib/i18n/server": { localizedMetadata: value => value },
      "next/headers": { cookies: async () => ({ get: key => ({ value: key === "varda_plan_return" ? intent : source }) }) },
      "@/lib/auth/current-session-subject": { readCurrentSessionSubject: async () => ({ state: "authenticated" }) },
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => resolution },
      "@/db/queries/account-management": { getReadOnlyTenantAccountManagementModel: async () => ({ state: "ready", hasAssetHistory, accounts: [{ isActive: false, activeHoldingCount: 0 }] }) },
      "@/db/queries/portfolio-drafts": { listPortfolioDrafts: async owner => { assert.deepEqual(owner, tenant); return drafts; } },
      "@/components/first-visit/quick-portfolio": { QuickPortfolio: named("QuickPortfolio") },
      "@/components/first-visit/public-nav": { PublicNav: named("PublicNav") },
      "@/components/auth/auth-shell": { AuthShell: named("AuthShell"), AuthHeading: named("AuthHeading") },
    });
    const run = () => page.default({ searchParams: Promise.resolve({}) });
    const first = await run();
    assert.equal(first.type.name, "QuickEntry");
    assert.equal(first.type(first.props).props.children.find(child => child?.type?.name === "QuickPortfolio").props.signedIn, true);
    intent = "1"; source = "quick";
    await assert.rejects(run(), /redirect:\/portfolio\/activate$/);
    source = "allocation";
    await assert.rejects(run(), /redirect:\/plans$/);
    intent = undefined; resolution = { ok: true, tenantContext: tenant };
    assert.equal((await run()).type.name, "QuickEntry");
    drafts = [saved];
    await assert.rejects(run(), /redirect:\/$/);
    // Closing every account or selling every holding must not restart onboarding.
    drafts = []; hasAssetHistory = true;
    await assert.rejects(run(), /redirect:\/$/);
    resolution = { ok: false, failure: { code: "unauthenticated" } };
    await assert.rejects(run(), /redirect:\/auth\/sign-in$/);
    resolution = { ok: false, failure: { code: "app_user_not_active" } };
    assert.equal((await run()).type.name, "OnboardingUnavailable");
  });
  it("renders owned approximate inputs on Home without demanding an account or inventing holdings", async () => {
    let resolution = { ok: true, tenantContext: tenant }, drafts = [saved], withAccounts = false, hasAssetHistory = false, historyUnavailable = false;
    const dashboard = { holdings: [], nonInvestmentAssets: [{ name: "Existing deposit", value: 4000000 }] };
    const [page] = await importUiWithPorts(["src/app/page.tsx"], {
      "next/navigation": { redirect },
      "next/link": { default: named("Link") },
      "@/lib/i18n/server": { localizedMetadata: value => value },
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => resolution },
      "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async () => ({ state: "ready", catalog: { scopes: withAccounts ? [{ kind: "all" }, { kind: "account" }] : [{ kind: "all" }] }, resolution: { state: "resolved", scope: { kind: "all" } } }) },
      "@/db/queries/portfolio-drafts": { listPortfolioDrafts: async owner => { assert.deepEqual(owner, tenant); return drafts; } },
      "@/db/queries/account-management": { getReadOnlyTenantAccountManagementModel: async ({ tenantContext }) => {
        assert.deepEqual(tenantContext, tenant);
        return historyUnavailable ? { state: "unavailable" } : { state: "ready", hasAssetHistory, accounts: [] };
      } },
      "@/lib/portfolio-dashboard": { getPortfolioDashboard: async () => withAccounts ? { ...dashboard, dataHealth: { assetCount: 0, importedAssetCount: 1 } } : { holdings: [], nonInvestmentAssets: [], dataHealth: { assetCount: 0, importedAssetCount: 0 } } },
      "@/lib/home-design-preview": { buildHomeDesignPreview: () => { throw new Error("no demo input in personal Home"); } },
      "@/components/first-visit/quick-home": { QuickHome: named("QuickHome") },
      "@/components/portfolio-dashboard": { PortfolioDashboard: named("PortfolioDashboard") },
      "@/components/secondary-page-header": { SecondaryPageHeader: named("SecondaryPageHeader") },
      "@/components/portfolio-analysis-scope-boundary": { PortfolioAnalysisScopeBoundary: named("ScopeBoundary") },
      "@/components/portfolio-dashboard-access-boundary": { PortfolioDashboardAccessBoundary: named("AccessBoundary") },
    });
    const run = () => page.default({ searchParams: Promise.resolve({}) });
    const shell = (await run()).props.children;
    const home = await shell.type(shell.props);
    assert.equal(home.type.name, "QuickHome");
    assert.deepEqual(home.props.input, input);
    withAccounts = true;
    const existing = await run();
    const existingContent = existing.props.children;
    const rendered = await existingContent.type(existingContent.props);
    assert.equal(rendered.props.children[1].type.name, "PortfolioDashboard");
    assert.deepEqual(rendered.props.children[1].props.data.nonInvestmentAssets, dashboard.nonInvestmentAssets);
    withAccounts = false;
    hasAssetHistory = true;
    // A stale approximate draft must not replace the real portfolio after sale.
    let emptyReal = (await run()).props.children;
    assert.equal((await emptyReal.type(emptyReal.props)).props.children[1].type.name, "PortfolioDashboard");
    drafts = [];
    emptyReal = (await run()).props.children;
    assert.equal((await emptyReal.type(emptyReal.props)).props.children[1].type.name, "PortfolioDashboard");
    hasAssetHistory = false; historyUnavailable = true;
    emptyReal = (await run()).props.children;
    assert.equal((await emptyReal.type(emptyReal.props)).props.children[1].type.name, "PortfolioDashboard");
    historyUnavailable = false;
    await assert.rejects(async () => { const empty = (await run()).props.children; await empty.type(empty.props); }, /redirect:\/portfolio\/onboarding$/);
    resolution = { ok: false, failure: { code: "identity_unlinked" } };
    await assert.rejects(run(), /redirect:\/portfolio\/onboarding$/);
    resolution = { ok: false, failure: { code: "unauthenticated" } };
    await assert.rejects(run(), /redirect:\/start$/);
    resolution = { ok: false, failure: { code: "app_user_not_active" } };
    assert.equal((await run()).type.name, "AccessBoundary");
  });
});

describe("tenant-scoped prior asset use", () => {
  it("counts archived and unlinked-account assets while excluding other owners", async () => {
    const pg = new PGlite();
    const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    try {
      await pg.exec("create table assets(id uuid, account_id uuid, canonical_owner_user_id uuid, archived_at timestamptz)");
      const [query] = await importWithPorts(["src/db/queries/account-management.ts"], {
        "@/db/client": { db: drizzle(pg) },
        "@/db/tenant-transaction-context": { runTenantReadTransaction: async id => { assert.equal(id, owner); return [[]]; } },
        "@/db/queries/tenant-group-reads": { loadTenantPortfolioGroupMemberships: async ({ tenantContext }) => {
          assert.equal(tenantContext.ownerUserId, owner); return { accountMemberships: [], assetMemberships: [] };
        } },
      });
      const read = () => query.getReadOnlyTenantAccountManagementModel({ serviceDate: "2026-09-13", tenantContext: { ownerUserId: owner } });
      await pg.query("insert into assets values($1,null,$2,now())", [other, other]);
      assert.equal((await read()).hasAssetHistory, false);
      await pg.query("insert into assets values($1,$2,$3,now())", [owner, other, owner]);
      let result = await read();
      assert.equal(result.state, "ready"); assert.equal(result.hasAssetHistory, true); assert.deepEqual(result.accounts, []);
      await pg.query("update assets set account_id=null where canonical_owner_user_id=$1", [owner]);
      result = await read();
      assert.equal(result.hasAssetHistory, true);
    } finally { await pg.close(); }
  });
});
