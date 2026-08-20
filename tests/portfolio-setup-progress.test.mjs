import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  derivePortfolioSetupProgress,
  PORTFOLIO_SETUP_POLICY,
} from "../src/lib/portfolio-setup-progress.ts";

const pageSource = source("../src/app/portfolio/accounts/page.tsx");
const panelSource = source("../src/components/portfolio-setup-progress.tsx");

describe("empty portfolio setup progress", () => {
  it("guides an empty tenant to create the first account", () => {
    const progress = derivePortfolioSetupProgress({
      activeAccountCount: 0,
      activeHoldingCount: 0,
    });

    assert.equal(PORTFOLIO_SETUP_POLICY.totalSteps, 3);
    assert.equal(progress.completedStepCount, 1);
    assert.equal(progress.isComplete, false);
    assert.deepEqual(progress.nextAction, {
      href: "#create-account",
      label: "Create first account",
    });
    assert.deepEqual(
      progress.steps.map(({ status }) => status),
      ["complete", "current", "pending"],
    );
  });

  it("guides an account owner to add the first holding", () => {
    const progress = derivePortfolioSetupProgress({
      activeAccountCount: 2,
      activeHoldingCount: 0,
    });

    assert.equal(progress.completedStepCount, 2);
    assert.deepEqual(progress.nextAction, {
      href: "/portfolio/holdings/new",
      label: "Add first holding",
    });
    assert.deepEqual(
      progress.steps.map(({ status }) => status),
      ["complete", "complete", "current"],
    );
  });

  it("does not accept a holding count without an active account root", () => {
    const progress = derivePortfolioSetupProgress({
      activeAccountCount: 0,
      activeHoldingCount: 3,
    });

    assert.equal(progress.completedStepCount, 1);
    assert.equal(progress.isComplete, false);
    assert.deepEqual(progress.nextAction, {
      href: "#create-account",
      label: "Create first account",
    });
  });

  it("hides setup guidance after an owned holding exists", () => {
    const progress = derivePortfolioSetupProgress({
      activeAccountCount: 1,
      activeHoldingCount: 1,
    });

    assert.equal(progress.completedStepCount, 3);
    assert.equal(progress.isComplete, true);
    assert.deepEqual(progress.nextAction, {
      href: "/",
      label: "Open dashboard",
    });
    assert.match(panelSource, /if \(progress\.isComplete\) return null/);
  });

  it("derives progress from the existing owner-scoped account read model", () => {
    assert.match(pageSource, /derivePortfolioSetupProgress\(\{/);
    assert.match(pageSource, /activeAccountCount: activeAccounts\.length/);
    assert.match(pageSource, /account\.activeHoldingCount/);
    assert.match(pageSource, /id="create-account"/);
    assert.doesNotMatch(`${pageSource}\n${panelSource}`, /\bfetch\s*\(/);
  });
});

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
