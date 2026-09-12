import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canTrackWebAnalyticsPath, sanitizeWebAnalyticsEvent } from "../src/lib/web-analytics-event.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

describe("Web Analytics event boundaries", () => {
  it("removes investment amounts, account/group UUIDs, scenario inputs and fragments", () => {
    for (const path of [
      "/additional-contribution?amount=12345678&scope=account%3Aaaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#allocation",
      "/investment-lab?scope=portfolio%3Abbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&kodexWeight=37&view=weights#experiment",
      "/history?scope=all&positionDate=2026-09-08&positionSource=fixture&detail=raw",
      "/simulation?scope=account%3Aaaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&token=synthetic-token-only#synthetic-secret",
    ]) {
      const input = Object.freeze({ type: "pageview", url: `https://varda-labs.vercel.app${path}` });
      const result = sanitizeWebAnalyticsEvent(input);
      assert.deepEqual(result, { type: "pageview", url: `https://varda-labs.vercel.app${path.split(/[?#]/)[0]}` });
      assert.notEqual(result, input);
      assert.ok(input.url.includes("?"));
    }
  });

  it("drops initial and later auth events including reset tokens and OAuth codes", () => {
    for (const path of ["/auth", "/auth/", "/auth/sign-in", "/auth/reset-password?token=synthetic-reset-token", "/auth/callback?code=synthetic-oauth-code&state=synthetic-state", "/%61uth/reset-password?token=synthetic-reset-token", "/api/investment-plans", "/api/auth/callback", "/oauth/callback"]) {
      for (const type of ["pageview", "event"]) assert.equal(sanitizeWebAnalyticsEvent({ type, url: `https://varda-labs.vercel.app${path}` }), null);
    }
    assert.equal(canTrackWebAnalyticsPath(null), false);
    assert.equal(canTrackWebAnalyticsPath("/auth/session"), false);
    assert.equal(canTrackWebAnalyticsPath("/portfolio/manage"), true);
  });

  it("fails closed for malformed, relative, non-web and credential-bearing URLs", () => {
    for (const url of ["", "not a URL", "/history?scope=all", "https://", "http://[", "javascript:alert(1)", "data:text/plain,synthetic", "https://synthetic:credential@example.test/history", "https://example.test/%E0%A4%A"]) {
      assert.equal(sanitizeWebAnalyticsEvent({ type: "pageview", url }), null, url);
    }
  });

  it("preserves allowed page paths and SDK event discriminants", () => {
    for (const type of ["pageview", "event"]) {
      assert.deepEqual(sanitizeWebAnalyticsEvent({ type, url: "https://varda-labs.vercel.app/portfolio/structure" }), { type, url: "https://varda-labs.vercel.app/portfolio/structure" });
    }
  });

  it("never mounts the SDK on initial auth and keeps its installed event callback safe after SPA auth navigation", async () => {
    let pathname = "/auth/reset-password";
    let mounts = 0;
    let installedBeforeSend;
    const [component] = await importUiWithPorts(["src/components/service-web-analytics.tsx"], {
      "next/navigation": { usePathname: () => pathname },
      "@vercel/analytics/next": { Analytics: props => { mounts += 1; installedBeforeSend = props.beforeSend; return null; } },
    });
    const render = () => renderToStaticMarkup(React.createElement(component.ServiceWebAnalytics));
    render();
    assert.equal(mounts, 0);
    pathname = "/history";
    render();
    assert.equal(mounts, 1);
    assert.deepEqual(installedBeforeSend({ type: "pageview", url: "https://varda-labs.vercel.app/history?scope=account%3Asynthetic" }), { type: "pageview", url: "https://varda-labs.vercel.app/history" });
    pathname = "/auth/sign-in";
    render();
    assert.equal(mounts, 1);
    assert.equal(installedBeforeSend({ type: "pageview", url: "https://varda-labs.vercel.app/auth/callback?code=synthetic" }), null);
  });
});
