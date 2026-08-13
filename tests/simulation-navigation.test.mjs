import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSimulationHref } from "../src/lib/simulation-navigation.ts";

describe("Simulation URL navigation", () => {
  it("uses the canonical dynamic scope for new navigation", () => {
    const scope = "portfolio:11111111-1111-4111-8111-111111111111";
    const url = new URL(
      buildSimulationHref({
        scope,
        endServiceDate: "2026-08-13",
        researchHorizon: 63,
        kodexWeightPct: 50,
        researchUniverse: null,
      }),
      "https://example.test",
    );

    assert.equal(url.searchParams.get("scope"), scope);
    assert.equal(url.searchParams.has("account"), false);
  });

  it("preserves the explicit research universe across date, horizon, and weight changes", () => {
    const researchUniverse =
      "korea:KRW:069500:5000,us:USD:QQQ:5000";
    const href = buildSimulationHref({
      account: "isa",
      endServiceDate: "2026-07-09",
      researchHorizon: 126,
      kodexWeightPct: 75,
      researchUniverse,
    });
    const url = new URL(href, "https://example.test");

    assert.equal(url.pathname, "/simulation");
    assert.equal(url.searchParams.get("account"), "isa");
    assert.equal(url.searchParams.get("end"), "2026-07-09");
    assert.equal(url.searchParams.get("horizon"), "126");
    assert.equal(url.searchParams.get("kodexWeight"), "75");
    assert.equal(
      url.searchParams.get("researchUniverse"),
      researchUniverse,
    );
  });

  it("omits only absent optional state", () => {
    const url = new URL(
      buildSimulationHref({
        account: null,
        endServiceDate: null,
        researchHorizon: 63,
        kodexWeightPct: null,
        researchUniverse: null,
      }),
      "https://example.test",
    );

    assert.equal(url.searchParams.get("horizon"), "63");
    assert.equal(url.searchParams.has("account"), false);
    assert.equal(url.searchParams.has("end"), false);
    assert.equal(url.searchParams.has("kodexWeight"), false);
    assert.equal(url.searchParams.has("researchUniverse"), false);
  });

  it("prefers a canonical scope when legacy compatibility input is also supplied", () => {
    const scope = "account:22222222-2222-4222-8222-222222222222";
    const url = new URL(
      buildSimulationHref({
        account: "isa",
        scope,
        endServiceDate: null,
        researchHorizon: 63,
        kodexWeightPct: null,
        researchUniverse: null,
      }),
      "https://example.test",
    );

    assert.equal(url.searchParams.get("scope"), scope);
    assert.equal(url.searchParams.has("account"), false);
  });
});
