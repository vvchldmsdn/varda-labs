import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { derivePortfolioSetupProgress } from "../src/lib/portfolio-setup-progress.ts";
import { AUTH_TRANSPORT_ALLOWED_API_ENDPOINTS } from "../src/lib/auth/auth-transport-policy.ts";

const read = (path) => readFileSync(path, "utf8");

describe("auth and onboarding experience", () => {
  it("connects social and email signup through the reviewed authentication boundary", () => {
    const signup = read("src/app/auth/sign-up/page.tsx");
    const controls = read("src/components/auth/auth-transport-controls.tsx");
    assert.match(signup, /mode="sign-up"/);
    assert.match(controls, /authClient\.signIn\.social/);
    assert.match(controls, /\["google", "github", "naver"\]/);
    const email = read("src/components/auth/email-auth-form.tsx");
    assert.match(email, /authClient.signUp.email/);
    assert.match(email, /authClient.signIn.email/);
    assert.equal(AUTH_TRANSPORT_ALLOWED_API_ENDPOINTS.length, 7);
    assert.match(controls, /aria-busy=\{status === "pending"\}/);
  });

  it("keeps local UI previews away from authentication and tenant writes", () => {
    const entry = read("src/components/auth/auth-entry.tsx");
    const page = read("src/app/portfolio/onboarding/page.tsx");
    const controls = read("src/components/auth/auth-transport-controls.tsx");
    assert.match(entry, /process.env.NODE_ENV === "development" && preview/);
    assert.match(entry, /runtime.state === "disabled" && !designPreview/);
    assert.match(
      page,
      /process.env.NODE_ENV === "development" && params.preview === "design"/,
    );
    assert.match(
      controls,
      /if \(preview\)\s*\{\s*setPreviewNotice\(true\);\s*return;/,
    );
    for (const file of [
      "self-service-tenant-onboarding-form",
      "onboarding-account-form",
    ]) {
      const source = read(`src/components/auth/${file}.tsx`);
      assert.match(source, /action=\{preview \? undefined : action\}/);
      assert.match(source, /event.preventDefault\(\)/);
    }
  });

  it("resumes the next incomplete step from owned persisted accounts", () => {
    const empty = derivePortfolioSetupProgress({
      activeAccountCount: 0,
      activeHoldingCount: 0,
    });
    const account = derivePortfolioSetupProgress({
      activeAccountCount: 1,
      activeHoldingCount: 0,
    });
    const ready = derivePortfolioSetupProgress({
      activeAccountCount: 1,
      activeHoldingCount: 1,
    });
    assert.equal(
      empty.steps.find((step) => step.status === "current").id,
      "account",
    );
    assert.equal(
      account.steps.find((step) => step.status === "current").id,
      "holding",
    );
    assert.equal(ready.isComplete, true);
    const page = read("src/app/portfolio/onboarding/page.tsx");
    assert.ok(
      page.indexOf("if (!resolution.ok)") <
        page.indexOf(
          "const model = await getReadOnlyTenantAccountManagementModel",
        ),
    );
    assert.match(page, /tenantContext: resolution.tenantContext/);
    assert.match(page, /account.isActive/);
    assert.match(page, /if \(progress.isComplete\) redirect\("\/"\)/);
    assert.match(page, /model.state !== "ready"/);
  });

  it("uses existing authorized writers and never marks progress in browser storage", () => {
    const actions = read("src/app/portfolio/onboarding/actions.ts");
    const form = read(
      "src/components/auth/self-service-tenant-onboarding-form.tsx",
    );
    assert.match(actions, /createCurrentSessionTenant\(formData\)/);
    assert.match(actions, /createAccount\(previousState, formData\)/);
    assert.match(actions, /redirect\("\/portfolio\/onboarding"\)/);
    assert.match(
      form,
      /SELF_SERVICE_TENANT_ONBOARDING_POLICY.confirmationValue/,
    );
    assert.match(form, /required/);
    assert.doesNotMatch(
      actions + form,
      /localStorage|sessionStorage|ownerUserId|providerSubject/,
    );
  });

  it("separates post-login continuation from explicit account management", () => {
    const session = read("src/app/auth/session/page.tsx");
    assert.match(session, /params.view !== "account"/);
    assert.match(session, /redirect\("\/portfolio\/onboarding"\)/);
    assert.match(session, /evidence === "unauthenticated"/);
    assert.doesNotMatch(session, /\.user\.(?:email|name|image)|@\/db/);
    assert.match(
      read("src/components/portfolio-primary-navigation.tsx"),
      /href="\/auth\/session\?view=account"/,
    );
    assert.match(
      read("src/components/auth/onboarding-view.tsx"),
      /기존 데이터 연결/,
    );
  });

  it("shares responsive presentation tokens and accessible form labels", () => {
    const shell = read("src/components/auth/auth-shell.tsx");
    const css = read("src/components/auth/auth-experience.module.css");
    const form = read("src/components/auth/onboarding-account-form.tsx");
    assert.match(shell, /varda-mark.png/);
    assert.match(css, /var\(--paper\)/);
    assert.match(css, /var\(--brand\)/);
    assert.match(css, /max-width: 600px/);
    assert.doesNotMatch(css, /\dvw|letter-spacing:\s*-/);
    assert.match(form, /htmlFor="onboarding-account-name"/);
    assert.match(form, /maxLength=\{100\}/);
    assert.match(form, /disabled=\{pending \|\| !name.trim\(\)\}/);
  });
});
