import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planReturnDestination } from "../src/lib/auth/plan-return.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

describe("plan authentication return", () => {
  it("accepts only a fixed intent after a verified session", () => {
    assert.equal(planReturnDestination("authenticated", "1"), "/plans");
    for (const state of ["unauthenticated", "unverified", "invalid", "unavailable"]) {
      assert.equal(planReturnDestination(state, "1"), null);
    }
    for (const value of [null, undefined, "", "true", "/plans", "https://example.test", "1;foo=bar"]) {
      assert.equal(planReturnDestination("authenticated", value), null);
    }
  });

  it("preserves ordinary auth destinations and shows cancellation only for a pending plan", async () => {
    let session = "authenticated";
    let intent = "1";
    const [entry] = await importUiWithPorts(["src/components/auth/auth-entry.tsx"], {
      "next/link": { default: () => null },
      "next/headers": { cookies: async () => ({ get: () => ({ value: intent }) }) },
      "next/navigation": { redirect: url => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("not-found"); } },
      "@/lib/auth/current-session-subject": { readCurrentSessionSubject: async () => ({ state: session }) },
      "@/lib/auth/auth-transport-runtime": { getAuthTransportRuntime: () => ({ state: "ready" }) },
      "@/lib/auth/auth-method-availability": { getAuthMethodAvailability: () => ({ emailPassword: true }) },
      "./auth-transport-controls": { SocialSignInButtons: () => null, SignOutButton: () => null },
      "./email-auth-form": { EmailAuthForm: () => null },
      "./auth-shell": { AuthHeading: () => null, AuthShell: () => null },
      "./auth-localized": { AuthElement: () => null, AuthText: () => null },
      "./plan-return-notice": { PlanReturnNotice: function PlanReturnNotice() { return null; } },
    });
    await assert.rejects(entry.AuthEntry({ mode: "sign-in" }), /redirect:\/plans$/);
    intent = undefined;
    await assert.rejects(entry.AuthEntry({ mode: "sign-in" }), /redirect:\/portfolio\/onboarding$/);
    const findNotice = node => {
      if (!node || typeof node !== "object") return false;
      if (node.type?.name === "PlanReturnNotice") return true;
      return [node.props?.children].flat(Infinity).some(findNotice);
    };
    session = "unverified";
    intent = "1";
    assert.equal(findNotice(await entry.AuthEntry({ mode: "sign-up" })), true);
    intent = undefined;
    assert.equal(findNotice(await entry.AuthEntry({ mode: "sign-in" })), false);
  });

  it("cancels only navigation intent without removing the draft", async () => {
    const [notice] = await importUiWithPorts(["src/components/auth/plan-return-notice.tsx"], {
      "next/link": { default: () => null },
      "@/components/i18n/localized-text": { T: () => null },
    });
    const element = notice.PlanReturnNotice();
    const link = element.props.children[1];
    assert.equal(link.props.href, "/try?mode=personal");
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;
    const previousStorage = globalThis.localStorage;
    const writes = [];
    globalThis.document = { set cookie(value) { writes.push(value); } };
    globalThis.location = { protocol: "https:" };
    globalThis.localStorage = { removeItem: () => { throw new Error("must preserve the draft"); }, clear: () => { throw new Error("must preserve unrelated storage"); } };
    try {
      link.props.onClick();
      assert.deepEqual(writes, ["varda_plan_return=; Path=/; Max-Age=0; SameSite=Lax; Secure"]);
    } finally {
      globalThis.document = previousDocument;
      globalThis.location = previousLocation;
      globalThis.localStorage = previousStorage;
    }
  });
});
