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
import { recoveryReturnHref } from "../src/lib/recovery-navigation.ts";

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
    assert.equal(Number(paths.body.en.match(/create ([\d,]+) possible paths/)?.[1].replaceAll(",", "")), policy.pathCount);
    assert.equal(Number(paths.detail.en.match(/main chart displays all ([\d,]+) paths/)?.[1].replaceAll(",", "")), policy.pathCount);
    assert.equal(Number(paths.detail.en.match(/Candidate charts display (\d+) samples/)?.[1]), policy.samplePathCount);
    assert.equal(Number(paths.detail.en.match(/a (\d+)% chance/)?.[1]) / 100, 1 / policy.expectedBlockLength);
    assert.match(paths.detail.en, /stretch lengths vary and average five/);
    assert.match(paths.detail.en, /summary statistics use every path/);
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

  it("keeps details available for ready and blocked calculations while deferring the nested guide", async () => {
    const [provider, owner] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx",
      "src/components/simulation/owner-research-execution-section.tsx",
    ], { "next/link": linkPort, "next/navigation": { useRouter: () => ({}) }, "next/dynamic": { default: () => function DeferredGuide() { throw new Error("The closed guide must not render its lazy contents"); } } });
    const base = {
      id: "owner-all", name: "내 포트폴리오", account: "all", instruments: [],
      policy: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY,
      endSelection: { status: "valid", endServiceDate: "2026-09-01", source: "latest_common_stored" },
      coverage: { modeledInstrumentCount: 1, candidateInstrumentCount: 1, modeledCurrentValuePct: 100, omittedWeightBps: 0 },
    };
    const ready = {
      ...base, status: "ready", executionWeights: [], samplePaths: [],
      assumptions: { horizon: 63, pathCount: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.pathCount },
      source: { endServiceDate: "2026-09-01", returnStepCount: 90, priceBasis: "raw_price_return" },
      terminal: { p50ReturnPct: 0, lossProbabilityPct: 0, maxDrawdownP50Pct: 0, maxDrawdownP90Pct: 0 },
      bands: [{ stepIndex: 0, p10: 100, p50: 100, p90: 100 }],
    };
    const blocked = { ...base, status: "unavailable", reason: "input_matrix_unavailable", assumptions: null };
    for (const initialLocale of ["ko", "en"]) {
      for (const execution of [ready, blocked]) {
        const markup = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale },
          React.createElement(owner.OwnerResearchExecutionSection, { execution, selectedScopeKey: "all" }),
        ));
        assert.ok(markup.includes(initialLocale === "ko" ? "세부 사항" : "Details"));
        assert.match(markup, new RegExp(`data-owner-research-status="${execution.status}"`));
        assert.doesNotMatch(markup, /data-calculation-guide=/);
      }
    }
  });

  it("gives unavailable calculations an honest next action in the selected account or group", async () => {
    const [provider, owner] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx", "src/components/simulation/owner-research-execution-section.tsx",
    ], { "next/link": linkPort, "next/navigation": { useRouter: () => ({}) }, "next/dynamic": { default: () => () => null } });
    const pushes = [];
    let refreshes = 0;
    const [{ RecoveryNotice }] = await importUiWithPorts(["src/components/recovery/recovery-notice.tsx"], {
      "next/navigation": { useRouter: () => ({ push: href => pushes.push(href), refresh: () => { refreshes += 1; } }) },
      "@/components/i18n/locale-provider": { useI18n: () => ({ t: (ko, en) => en ?? ko }) },
      react: { useTransition: () => [false, callback => callback()] },
    });
    const elements = node => Array.isArray(node) ? node.flatMap(elements) : node && typeof node === "object" ? [node, ...elements(node.props?.children)] : [];
    const globals = new Map(["location", "document", "HTMLFormElement", "FormData"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    class RecoveryForm {}
    Object.defineProperties(globalThis, {
      HTMLFormElement: { configurable: true, value: RecoveryForm },
      document: { configurable: true, value: { getElementById: id => { assert.equal(id, "simulation-date-filter"); return new RecoveryForm(); } } },
      FormData: { configurable: true, value: class { constructor(form) { assert.ok(form instanceof RecoveryForm); } get(name) { assert.equal(name, "end"); return "2026-10-25"; } } },
    });
    try {
      for (const selectedScopeKey of ["account:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "portfolio:cccccccc-cccc-4ccc-8ccc-cccccccccccc"]) {
        Object.defineProperty(globalThis, "location", { configurable: true, value: new URL(`/simulation?${new URLSearchParams({ scope: selectedScopeKey, end: "2026-09-01", horizon: "126" })}`, "https://example.test") });
        for (const initialLocale of ["ko", "en"]) {
          for (const reason of ["owner_input_unavailable", "historical_evidence_not_admitted", "input_matrix_unavailable", "input_matrix_shape_mismatch", "invalid_end_service_date", "invalid_horizon_selection"]) {
            const execution = { status: "unavailable", reason, policy: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY, assumptions: null, account: selectedScopeKey, instruments: [], endSelection: { status: "unavailable", endServiceDate: null, source: "latest_common_stored" }, coverage: { modeledInstrumentCount: 0, candidateInstrumentCount: 2, modeledCurrentValuePct: 0, omittedWeightBps: 0 } };
            const markup = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale }, React.createElement(owner.OwnerResearchExecutionSection, { execution, selectedScopeKey })));
            assert.match(markup, initialLocale === "ko" ? /아직 이 구성으로 계산할 수 없습니다/ : /This portfolio cannot be simulated yet/);
            assert.doesNotMatch(markup, /계산에 필요한 근거를 확인하고 있습니다|We are checking the evidence/);
            if (reason.startsWith("invalid_")) {
              const href = markup.match(/href="([^"]+)"/)?.[1];
              assert.ok(href);
              const url = new URL(href.replaceAll("&amp;", "&"), "https://example.test");
              assert.equal(url.searchParams.get("scope"), selectedScopeKey);
              assert.equal(url.pathname, "/simulation");
            } else {
              const expectedKind = reason === "owner_input_unavailable" ? "holdings" : reason === "input_matrix_shape_mismatch" ? "retry" : "market";
              assert.match(markup, new RegExp(`data-recovery-kind="${expectedKind}"`));
              const notice = elements(owner.OwnerResearchExecutionSection({ execution, selectedScopeKey })).find(node => node.type?.name === "RecoveryNotice");
              assert.ok(notice);
              assert.equal(notice.props.scope, selectedScopeKey);
              const buttons = elements(RecoveryNotice(notice.props)).filter(node => node.type === "button");
              const beforePushes = pushes.length, beforeRefreshes = refreshes;
              buttons[0].props.onClick();
              if (expectedKind === "retry") {
                assert.equal(refreshes, beforeRefreshes + 1);
                assert.equal(pushes.length, beforePushes, "invalid evidence must not navigate to an editing screen");
              } else {
                assert.equal(pushes.length, beforePushes + 1);
                const url = new URL(pushes.at(-1), "https://example.test");
                assert.equal(url.pathname, "/portfolio/holdings");
                assert.equal(url.searchParams.get("scope"), selectedScopeKey);
                const back = new URL(recoveryReturnHref(url.hash), "https://example.test");
                assert.equal(back.pathname, "/simulation");
                assert.equal(back.searchParams.get("scope"), selectedScopeKey);
                assert.equal(back.searchParams.get("horizon"), "126");
                assert.equal(back.searchParams.get("end"), "2026-10-25", "recovery must preserve the currently edited form date");
                buttons[1].props.onClick();
                assert.equal(refreshes, beforeRefreshes + 1);
              }
            }
            if (reason === "historical_evidence_not_admitted") assert.match(markup, initialLocale === "ko" ? /과거 가격·환율/ : /Historical prices, exchange rates/);
          }
        }
      }
    } finally {
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
});
