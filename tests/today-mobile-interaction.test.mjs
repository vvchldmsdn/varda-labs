import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const copyPorts = {
  "@/components/i18n/locale-provider": { useI18n: () => ({ t: (ko, en) => en ?? ko }) },
  "@/components/i18n/localized-text": { T: () => null },
};
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
const rows = [
  { key: "brokerage|us|VOO", name: "User holding A", ticker: "VOO", accountLabel: "증권", changeKrw: 300, returnPct: 3, priceImpactKrw: 200, fxImpactKrw: 100, tradeFlowKrw: 0, selected: false, href: "/today?holdingAccount=brokerage&market=us&ticker=VOO&scope=account%3A11111111-1111-4111-8111-111111111111&preview=design" },
  { key: "isa|us|VOO", name: "User holding B", ticker: "VOO", accountLabel: "ISA", changeKrw: -100, returnPct: -1, priceImpactKrw: -100, fxImpactKrw: 0, tradeFlowKrw: 500, selected: false, href: "/today?holdingAccount=isa&market=us&ticker=VOO&scope=all&preview=design" },
];

describe("Today mobile selection and holding dialog", () => {
  it("selects a mobile row locally, then opens only the exact selected account URL from its summary", async () => {
    const states = [];
    let stateIndex = 0;
    const Link = () => null;
    const [component] = await importUiWithPorts(["src/components/today/today-contribution-explorer.tsx"], {
      ...copyPorts, "next/link": { default: Link },
      react: { useId: () => "dot", useState: initial => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      } },
    });
    const render = (input = rows) => { stateIndex = 0; return elements(component.TodayContributionExplorer({ rows: input })); };
    let tree = render();
    const mobileButtons = tree.filter(element => element.props?.["data-today-select-holding"]);
    assert.equal(mobileButtons.length, 2);
    assert.ok(mobileButtons.every(element => element.type === "button" && element.props.href === undefined));
    const before = structuredClone(rows);
    mobileButtons[1].props.onClick();
    tree = render();
    const selected = tree.find(element => element.props?.["data-today-select-holding"] === rows[1].key);
    assert.equal(selected.props["aria-pressed"], true);
    const summary = tree.find(element => element.props?.id === "today-selected-holding-summary");
    assert.equal(summary.type, Link);
    assert.equal(summary.props.href, rows[1].href);
    assert.equal(summary.props.prefetch, false, "detail history must not be prefetched before opening");
    assert.equal(summary.props.scroll, false);
    assert.equal(summary.props["aria-label"], "View User holding B details");
    assert.deepEqual(rows, before, "selection must not change financial values, names or identities");
    tree = render(rows.map(row => ({ ...row, changeKrw: row.changeKrw + 12 })));
    assert.equal(tree.find(element => element.props?.id === "today-selected-holding-summary").props.href, rows[1].href, "a live update retains local selection");
    const desktop = tree.filter(element => element.props?.["data-holding-detail-trigger"] === "row");
    assert.equal(desktop.length, 2);
    assert.equal(desktop[0].type, Link);
    assert.equal(desktop[0].props.href, rows[0].href);
    assert.equal(typeof desktop[0].props.onMouseEnter, "function");
  });

  it("falls back within the current authorized rows when a scope change removes the selected holding", async () => {
    let index = 0;
    const states = [null, rows[1].key];
    const [component] = await importUiWithPorts(["src/components/today/today-contribution-explorer.tsx"], {
      ...copyPorts, "next/link": { default: () => null }, react: { useId: () => "dot", useState: () => [states[index++], () => {}] },
    });
    const tree = elements(component.TodayContributionExplorer({ rows: [rows[0]] }));
    assert.equal(tree.find(element => element.props?.id === "today-selected-holding-summary").props.href, rows[0].href);
  });

  for (const method of ["button", "escape", "backdrop"]) {
    it(`closes via ${method}, restores focus and body scroll, and preserves the canonical close URL`, async test => {
      const h = await drawerHarness(test);
      h.mount();
      assert.equal(h.dialog.open, true);
      assert.equal(h.document.body.style.overflow, "hidden");
      assert.equal(h.document.activeElement, h.closeButton);
      if (method === "button") h.closeControl.props.onClick();
      if (method === "escape") { let prevented = false; h.tree.props.onCancel({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); }
      if (method === "backdrop") { h.tree.props.onPointerDown(h.pointer(10, 10)); h.tree.props.onClick(h.pointer(10, 10)); }
      assert.equal(h.dialog.open, false);
      assert.equal(h.document.body.style.overflow, "clip");
      assert.equal(h.document.activeElement, h.trigger);
      assert.deepEqual(h.pushes, [[h.closeHref, { scroll: false }]]);
      h.closeControl.props.onClick();
      assert.equal(h.pushes.length, 1, "duplicate close gestures must not enqueue extra route changes");
    });
  }

  it("does not dismiss while scrolling inside or dragging from content onto the backdrop", async test => {
    const h = await drawerHarness(test);
    h.mount();
    h.tree.props.onPointerDown(h.pointer(60, 100, h.closeButton));
    h.tree.props.onClick(h.pointer(10, 10));
    assert.equal(h.dialog.open, true);
    assert.equal(h.pushes.length, 0);
    h.tree.props.onPointerDown(h.pointer(60, 100));
    h.tree.props.onClick(h.pointer(60, 100));
    assert.equal(h.dialog.open, true);
  });

  it("traps forward and reverse Tab at the dialog boundaries and restores a visible summary if its trigger was replaced", async test => {
    const h = await drawerHarness(test);
    h.mount();
    h.document.activeElement = h.lastControl;
    let prevented = false;
    h.tree.props.onKeyDown({ key: "Tab", shiftKey: false, currentTarget: h.dialog, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(h.document.activeElement, h.closeButton);
    h.tree.props.onKeyDown({ key: "Tab", shiftKey: true, currentTarget: h.dialog, preventDefault() {} });
    assert.equal(h.document.activeElement, h.lastControl);
    h.trigger.isConnected = false;
    h.closeControl.props.onClick();
    assert.equal(h.document.activeElement, h.fallback);
  });
});

async function drawerHarness(test) {
  const descriptors = new Map(["document", "HTMLElement"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const effects = [];
  const pushes = [];
  const document = { body: { style: { overflow: "clip" } }, activeElement: null };
  class Element {
    isConnected = true;
    focus(options) { assert.equal(options?.preventScroll, true); document.activeElement = this; }
    getClientRects() { return [1]; }
  }
  const trigger = new Element();
  const fallback = new Element();
  const closeButton = new Element();
  const lastControl = new Element();
  // Keyboard focus methods in the existing native-dialog trap do not pass scroll options.
  for (const element of [closeButton, lastControl]) element.focus = () => { document.activeElement = element; };
  document.activeElement = trigger;
  document.querySelectorAll = () => [fallback];
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; },
    getBoundingClientRect: () => ({ left: 24, top: 40, right: 366, bottom: 804 }), querySelectorAll: () => [closeButton, lastControl] };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Element });
  const [component] = await importUiWithPorts(["src/components/today/holding-detail-drawer.tsx"], {
    ...copyPorts, "next/navigation": { useRouter: () => ({ push: (...args) => pushes.push(args) }) }, "lucide-react": { X: () => null },
    react: { useRef: initial => ({ current: initial }), useEffect: callback => { effects.push(callback); } },
  });
  const closeHref = "/today?scope=account%3A11111111-1111-4111-8111-111111111111&preview=design";
  const tree = component.HoldingDetailDrawer({ closeHref, children: "REAL_SERVER_DETAIL" });
  const closeControl = elements(tree).find(element => element.type === "button");
  tree.props.ref.current = dialog;
  closeControl.props.ref.current = closeButton;
  let cleanup;
  test.after(() => {
    cleanup?.();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  return { tree, dialog, document, trigger, fallback, closeButton, closeControl, lastControl, pushes, closeHref,
    mount() { cleanup = effects[0](); }, pointer(clientX, clientY, target = dialog) { return { clientX, clientY, target, currentTarget: dialog }; } };
}
