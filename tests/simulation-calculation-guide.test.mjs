import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { simulationCalculationGuide } from "../src/components/simulation/simulation-calculation-guide.ts";
import { SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY } from "../src/lib/simulation-owner-research-execution.ts";
import { SIMULATION_RESEARCH_HORIZON_POLICY } from "../src/lib/simulation-research-horizon.ts";
import { calculateSimulationPathMaxDrawdowns } from "../src/lib/simulation-path-max-drawdown.ts";
import { syntheticPathMaxDrawdownInput } from "./fixtures/simulation-path-max-drawdown.mjs";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const linkPort = { default: ({ href, children, prefetch, ...props }) => {
  assert.equal(prefetch, false);
  return React.createElement("a", { ...props, href }, children);
} };

describe("beginner simulation calculation guide", () => {
  it("describes the connected bootstrap settings without conflating sample paths and full-distribution results", () => {
    const policy = SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY;
    const history = simulationCalculationGuide.steps.find(step => step.id === "history");
    const paths = simulationCalculationGuide.steps.find(step => step.id === "paths");
    assert.equal(Number(history.body.en.match(/latest (\d+) observation/)?.[1]), policy.sourceReturnStepCount);
    assert.equal(Number(paths.body.en.match(/create (\d+) possible paths/)?.[1]), policy.pathCount);
    assert.equal(Number(paths.detail.en.match(/Only (\d+) sample paths/)?.[1]), policy.samplePathCount);
    assert.equal(Number(paths.detail.en.match(/a (\d+)% chance/)?.[1]) / 100, 1 / policy.expectedBlockLength);
    assert.match(paths.detail.en, /stretch lengths vary and average five/);
    assert.match(paths.detail.en, /all 500 are used for the summary statistics/);
    assert.deepEqual(paths.nodes.at(-1).detail.en.match(/\d+/g).map(Number), SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons);
    assert.match(paths.takeAway.en, /No trades rebalance/);
    assert.match(history.takeAway.en, /same date stay together/);
    assert.match(history.detail.en, /unadjusted KIS closes/);
  });

  it("uses a clearly illustrative example whose final gain and drawdown agree with the real drawdown engine", () => {
    const example = simulationCalculationGuide.steps.find(step => step.id === "results").example;
    const values = example.body.en.match(/For ([\d →]+),/)[1].split(" → ").map(Number);
    const normalized = values.map(value => value / values[0]);
    const result = calculateSimulationPathMaxDrawdowns(syntheticPathMaxDrawdownInput({ pathNavs: [normalized] }));
    assert.equal(result.drawdownStatus, "ready");
    const finalGain = (normalized.at(-1) - 1) * 100;
    const mentionedGain = Number(example.body.en.match(/final gain is \+(\d+)%/)[1]);
    const mentionedDrop = Number(example.body.en.match(/is (\d+)%\./)[1]);
    assert.ok(Math.abs(finalGain - mentionedGain) < 1e-10);
    assert.equal(result.pathDrawdowns[0].maxDrawdown * 100, mentionedDrop);
    assert.match(example.label.ko, /내 계산 결과 아님/);
    assert.match(example.label.en, /Not your result/);
  });

  it("renders every step in both languages and keeps detailed evidence collapsed", async () => {
    const [provider, guide, disclosure] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx",
      "src/components/explanations/calculation-guide.tsx",
      "src/components/simulation/simulation-disclosure.tsx",
    ], {});
    for (const initialLocale of ["ko", "en"]) {
      for (const step of simulationCalculationGuide.steps) {
        const markup = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale },
          React.createElement(guide.default, { guide: { ...simulationCalculationGuide, steps: [step] } }),
        ));
        assert.ok(markup.includes(step.title[initialLocale]));
        assert.doesNotMatch(markup, /\[object Object\]/);
        assert.match(markup, /aria-current="step"/);
        assert.doesNotMatch(markup, /<details[^>]*\sopen(?:[\s=>])/);
      }
      const detailMarkup = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale },
        React.createElement(disclosure.SimulationDisclosure, { title: "두 확률모형 비교", detail: "블록 재표본 추출과 환율·금리 요인 모형" },
          React.createElement("table", { "data-actual-evidence": true }, React.createElement("tbody", null, React.createElement("tr", null, React.createElement("td", null, "069500")))),
        ),
      ));
      assert.match(detailMarkup, /<details/);
      assert.doesNotMatch(detailMarkup, /<dialog|<details[^>]*\sopen(?:[\s=>])/);
      assert.match(detailMarkup, /data-actual-evidence="true"/);
      assert.ok(detailMarkup.includes(initialLocale === "ko" ? "두 확률모형 비교" : "Compare two probability models"));
    }
  });

  it("keeps the guide available for ready and blocked calculations while deferring the unopened guide", async () => {
    const [provider, owner] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx",
      "src/components/simulation/owner-research-execution-section.tsx",
    ], { "next/link": linkPort, "next/dynamic": { default: () => function DeferredGuide() { throw new Error("The closed guide must not render its lazy contents"); } } });
    const base = {
      id: "owner-all", name: "내 포트폴리오", account: "all", instruments: [],
      endSelection: { endServiceDate: "2026-09-01", source: "latest_common_stored" },
      coverage: { modeledInstrumentCount: 1, candidateInstrumentCount: 1, modeledCurrentValuePct: 100, omittedWeightBps: 0 },
    };
    const ready = {
      ...base, status: "ready", executionWeights: [], samplePaths: [],
      assumptions: { horizon: 63, pathCount: 500 },
      source: { endServiceDate: "2026-09-01", returnStepCount: 90, priceBasis: "raw_price_return" },
      terminal: { p50ReturnPct: 0, lossProbabilityPct: 0, maxDrawdownP90Pct: 0 },
      bands: [{ stepIndex: 0, p10: 100, p50: 100, p90: 100 }],
    };
    const blocked = { ...base, status: "unavailable", reason: "input_matrix_unavailable" };
    for (const initialLocale of ["ko", "en"]) {
      for (const execution of [ready, blocked]) {
        const markup = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale },
          React.createElement(owner.OwnerResearchExecutionSection, { execution, selectedScopeKey: "all" }),
        ));
        assert.ok(markup.includes(initialLocale === "ko" ? "계산 과정" : "How it works"));
        assert.match(markup, new RegExp(`data-owner-research-status="${execution.status}"`));
        assert.doesNotMatch(markup, /data-calculation-guide=/);
      }
    }
  });

  it("gives unavailable calculations an honest next action in the selected account or group", async () => {
    const [provider, owner] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx", "src/components/simulation/owner-research-execution-section.tsx",
    ], { "next/link": linkPort, "next/dynamic": { default: () => () => null } });
    for (const selectedScopeKey of ["account:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "portfolio:cccccccc-cccc-4ccc-8ccc-cccccccccccc"]) {
      for (const initialLocale of ["ko", "en"]) {
        for (const reason of ["owner_input_unavailable", "historical_evidence_not_admitted", "input_matrix_unavailable", "invalid_end_service_date", "invalid_horizon_selection"]) {
          const execution = { status: "unavailable", reason, account: selectedScopeKey, instruments: [], endSelection: { endServiceDate: null, source: "latest_common_stored" }, coverage: { modeledInstrumentCount: 0, candidateInstrumentCount: 2, modeledCurrentValuePct: 0, omittedWeightBps: 0 } };
          const markup = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale }, React.createElement(owner.OwnerResearchExecutionSection, { execution, selectedScopeKey })));
          assert.match(markup, initialLocale === "ko" ? /아직 이 구성으로 계산할 수 없습니다/ : /This portfolio cannot be simulated yet/);
          assert.doesNotMatch(markup, /계산에 필요한 근거를 확인하고 있습니다|We are checking the evidence/);
          const href = markup.match(/href="([^"]+)"/)?.[1];
          assert.ok(href);
          const url = new URL(href.replaceAll("&amp;", "&"), "https://example.test");
          assert.equal(url.searchParams.get("scope"), selectedScopeKey);
          assert.equal(url.pathname, reason.startsWith("invalid_") ? "/simulation" : "/portfolio/holdings");
          if (reason === "historical_evidence_not_admitted") assert.match(markup, initialLocale === "ko" ? /과거 가격·환율/ : /Historical prices, exchange rates/);
        }
      }
    }
  });
});
