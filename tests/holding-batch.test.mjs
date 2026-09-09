import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const accountId = "11111111-1111-4111-8111-111111111111";
const idle = { status: "idle", results: [] };
const success = { status: "success", message: "Saved", assetId: "33333333-3333-4333-8333-333333333333" };
const draft = (key, extra = {}) => ({ key, instrumentId: "", ticker: key, name: key, market: "us", assetType: "stock", quantity: "2", averageCost: "", currentPrice: "100", ...extra });
function request(rows, extra = {}) {
  const data = new FormData();
  data.set("accountId", accountId);
  data.set("holdings", typeof rows === "string" ? rows : JSON.stringify(rows));
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}
async function fixture(outcomes = []) {
  const writes = [];
  const revalidated = [];
  const [actions] = await importWithPorts(["src/app/portfolio/holdings/new/actions.ts"], {
    "next/cache": { revalidatePath: (path) => revalidated.push(path) },
    "@/lib/holding-onboarding-write": { writeSessionHoldingOnboarding: async (data) => {
      writes.push(Object.fromEntries(data));
      const outcome = outcomes[writes.length - 1] ?? success;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    } },
  });
  return { ...actions, writes, revalidated };
}

describe("holding batch saves", () => {
  it("rejects malformed or oversized payloads and more than twelve rows before any write", async () => {
    const f = await fixture();
    for (const rows of ["{broken", " ".repeat(32_001), {}, [], Array.from({ length: 13 }, (_, i) => draft(`A${i}`))]) {
      assert.equal((await f.createHoldingBatch(idle, request(rows))).status, "invalid");
    }
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.revalidated, []);
  });

  it("validates all rows before writing even when only a later row is invalid", async () => {
    const f = await fixture();
    for (const bad of [draft("B", { quantity: "-1" }), draft("B", { averageCost: "0" }), draft("B", { quantity: 2 }), draft(""), draft("A")]) {
      assert.equal((await f.createHoldingBatch(idle, request([draft("A"), bad]))).status, "invalid");
    }
    assert.equal(f.writes.length, 0);
  });

  it("rejects duplicate canonical instruments regardless of row key or ticker case", async () => {
    const f = await fixture();
    assert.equal((await f.createHoldingBatch(idle, request([draft("one", { ticker: " aapl " }), draft("two", { ticker: "AAPL" })]))).status, "invalid");
    assert.equal(f.writes.length, 0);
  });

  it("accepts twelve distinct holdings and revalidates each affected route only once", async () => {
    const f = await fixture();
    const result = await f.createHoldingBatch(idle, request(Array.from({ length: 12 }, (_, i) => draft(`A${i}`))));
    assert.equal(result.status, "complete");
    assert.equal(f.writes.length, 12);
    assert.equal(result.results.length, 12);
    assert.equal(new Set(f.revalidated).size, f.revalidated.length);
    for (const path of ["/", "/history", "/portfolio/first-look", "/portfolio/onboarding", "/portfolio/holdings/new"]) assert.ok(f.revalidated.includes(path));
  });

  it("preserves successes and stops at quote readiness or authentication failure", async () => {
    for (const failure of [{ status: "price_unavailable", message: "Wait", retryAfterSeconds: 42 }, { status: "unauthorized", message: "Sign in" }]) {
      const f = await fixture([success, failure]);
      const result = await f.createHoldingBatch(idle, request([draft("A"), draft("B"), draft("C")]));
      assert.equal(result.status, "partial");
      assert.deepEqual(result.results, [{ key: "A", result: success }, { key: "B", result: failure }]);
      assert.deepEqual(f.writes.map((row) => row.ticker), ["A", "B"]);
      assert.ok(f.revalidated.includes("/portfolio/first-look"));
    }
  });

  it("writes only submitted retry rows and does not trust success claims in previous client state", async () => {
    const f = await fixture();
    const previous = { status: "partial", results: [{ key: "A", result: success }, { key: "B", result: success }] };
    assert.equal((await f.createHoldingBatch(previous, request([draft("B")]))).status, "complete");
    assert.deepEqual(f.writes.map((row) => row.ticker), ["B"]);
  });

  it("does not convert a duplicate holding conflict into a successful save", async () => {
    const conflict = { status: "conflict", message: "Already registered" };
    const f = await fixture([conflict]);
    const result = await f.createHoldingBatch(idle, request([draft("A")]));
    assert.equal(result.status, "partial");
    assert.deepEqual(result.results, [{ key: "A", result: conflict }]);
    assert.deepEqual(f.revalidated, []);
  });

  it("keeps earlier results after an unexpected writer failure and stops further attempts", async () => {
    const f = await fixture([success, new Error("transport disconnected")]);
    const result = await f.createHoldingBatch(idle, request([draft("A"), draft("B"), draft("C")]));
    assert.equal(result.status, "partial");
    assert.equal(result.results[0].result.status, "success");
    assert.equal(result.results[1].result.status, "error");
    assert.equal(f.writes.length, 2);
    assert.ok(f.revalidated.includes("/portfolio/holdings"));
  });
});

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

async function batchFormFixture(locale, outcomes, { collectionState = null } = {}) {
  const state = [];
  const submissions = [];
  let stateIndex = 0, actionState = idle, action;
  const InstrumentSearch = () => null;
  const [component] = await importUiWithPorts(["src/components/holding-onboarding-form.tsx"], {
    react: {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useActionState(callback) {
        action = async data => { actionState = await callback(actionState, data); };
        return [actionState, action, false];
      },
    },
    "next/link": { default: () => null },
    "@/components/use-market-collection-polling": { useMarketCollectionPolling: () => collectionState },
    "@/components/i18n/locale-provider": { useI18n: () => ({ t: (ko, en) => locale === "ko" ? ko : en }) },
    "@/components/i18n/management-text": { ManagementText: () => null },
    "@/components/onboarding/instrument-search": { InstrumentSearch },
    "@/components/onboarding/holding-import-panel": { HoldingImportPanel: () => null },
    "@/app/portfolio/holdings/new/actions": { createHoldingBatch: async (_previous, data) => {
      const rows = JSON.parse(data.get("holdings"));
      submissions.push(rows);
      return outcomes[submissions.length - 1](rows);
    } },
  });
  function render() {
    stateIndex = 0;
    return elements(component.HoldingOnboardingForm({ options: {
      state: "ready", accounts: [{ id: accountId, name: "QA", accountType: "securities", code: "qa" }], portfolioGroups: [],
    } }));
  }
  return {
    render, submissions,
    add(ticker) {
      render().find(node => node.type === InstrumentSearch).props.onSelect({ id: "", ticker, name: ticker, market: "us", currency: "USD", assetType: "stock" });
      const quantity = render().find(node => node.props?.className === "varda-onboarding-quantity");
      elements(quantity).find(node => node.type === "input").props.onChange({ target: { value: "1" } });
      render().find(node => node.type === "button" && node.props.className === "varda-onboarding-secondary").props.onClick();
    },
    async submit() {
      const data = new FormData();
      for (const node of render()) if (node.type === "input" && node.props.type === "hidden") data.set(node.props.name, node.props.value);
      await action(data);
    },
  };
}

const waitingPrice = { status: "price_unavailable", message: "Price lookup queued" };
const partialNotice = nodes => nodes.find(node => node.props?.role === "status" && node.props.className === "varda-onboarding-hint")?.props.children;

describe("holding batch completion notices", () => {
  for (const locale of ["ko", "en"]) {
    it(`${locale}: keeps a quote-only request unsaved and does not claim that holdings were saved`, async () => {
      const h = await batchFormFixture(locale, [rows => ({ status: "partial", results: [{ key: rows[0].key, result: waitingPrice }] })]);
      h.add("AAPL"); h.add("MSFT");
      await h.submit();
      const nodes = h.render();
      assert.equal(nodes.some(node => node.props?.className === "varda-onboarding-success"), false);
      assert.match(partialNotice(nodes), locale === "ko" ? /아직 저장된 종목이 없습니다.*가격 확인/ : /No holdings have been saved yet.*prices/);
      const retryRows = JSON.parse(nodes.find(node => node.type === "input" && node.props.name === "holdings").props.value);
      assert.deepEqual(retryRows.map(row => row.ticker), ["AAPL", "MSFT"]);
    });

    it(`${locale}: preserves a real earlier success when a later retry still waits for a quote`, async () => {
      const h = await batchFormFixture(locale, [
        rows => ({ status: "partial", results: [{ key: rows[0].key, result: success }, { key: rows[1].key, result: waitingPrice }] }),
        rows => ({ status: "partial", results: [{ key: rows[0].key, result: waitingPrice }] }),
      ]);
      h.add("AAPL"); h.add("MSFT");
      await h.submit();
      assert.equal(h.render().some(node => node.props?.className === "varda-onboarding-success"), true);
      await h.submit();
      assert.deepEqual(h.submissions[1].map(row => row.ticker), ["MSFT"]);
      const nodes = h.render();
      assert.equal(nodes.some(node => node.props?.className === "varda-onboarding-success"), true);
      assert.match(partialNotice(nodes), locale === "ko" ? /^저장된 종목은 유지/ : /^Saved holdings are kept/);
    });
  }

  it("does not call a validation or ownership conflict a pending price lookup", async () => {
    const h = await batchFormFixture("en", [rows => ({ status: "partial", results: [{ key: rows[0].key, result: { status: "conflict", message: "Account changed" } }] })]);
    h.add("AAPL");
    await h.submit();
    assert.match(partialNotice(h.render()), /No holdings have been saved yet.*Check each holding/);
    assert.doesNotMatch(partialNotice(h.render()), /prices/);
  });

  it("removes stale polling wait guidance after a retry successfully saves the remaining holdings", async () => {
    const h = await batchFormFixture("en", [
      rows => ({ status: "partial", results: [{ key: rows[0].key, result: success }, { key: rows[1].key, result: waitingPrice }] }),
      rows => ({ status: "complete", results: rows.map(row => ({ key: row.key, result: success })) }),
    ], { collectionState: "waiting" });
    h.add("AAPL"); h.add("MSFT");
    await h.submit();
    const waitingGuidance = nodes => nodes.some(node => node.props?.role === "status" && typeof node.props.children === "string" && /Price lookup is still pending/.test(node.props.children));
    assert.equal(waitingGuidance(h.render()), true);
    await h.submit();
    const nodes = h.render();
    assert.equal(nodes.some(node => node.props?.className === "varda-onboarding-success"), true);
    assert.equal(waitingGuidance(nodes), false, "completed saves supersede a previous polling timeout");
    const remaining = JSON.parse(nodes.find(node => node.type === "input" && node.props.name === "holdings").props.value);
    assert.deepEqual(remaining, []);
  });
});
