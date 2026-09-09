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

/** Exercise real component event handlers; native modal focus/Escape is covered by browser QA. */
function eventHooks() {
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  return {
    beginRender() { stateIndex = 0; refIndex = 0; },
    react: {
      useId: () => "test-accessible-panel",
      useMemo: callback => callback(),
      useEffect: () => {},
      useState: initial => {
        const index = stateIndex++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], next => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useRef: initial => {
        const index = refIndex++;
        if (!(index in refs)) refs[index] = { current: initial };
        return refs[index];
      },
    },
  };
}

async function datePickerHarness() {
  const hooks = eventHooks();
  const changes = [];
  const dates = Object.freeze(["2026-09-07", "2026-09-08", "2026-09-09"]);
  const [component] = await importUiWithPorts(["src/components/home/holding-date-picker.tsx"], { ...copyPorts, react: hooks.react });
  let tree;
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; elements(tree).find(element => element.type === "dialog").props.onClose(); } };
  const render = () => {
    hooks.beginRender();
    tree = component.HoldingDatePicker({ dates, value: "2026-09-09", onChange: date => changes.push(date) });
    const renderedDialog = elements(tree).find(element => element.type === "dialog");
    renderedDialog.props.ref.current = dialog;
    return elements(tree);
  };
  const open = () => { render().find(element => element.props?.["aria-haspopup"] === "dialog").props.onClick(); return render(); };
  return { dates, changes, dialog, render, open };
}

describe("Home mobile date and FX interactions", () => {
  it("opens the date picker without changing the value and commits only the selected canonical date", async () => {
    const h = await datePickerHarness();
    assert.equal(h.render().filter(element => element.props?.["aria-pressed"] !== undefined).length, 0);
    const tree = h.open();
    assert.equal(h.dialog.open, true);
    assert.deepEqual(h.changes, []);
    assert.equal(tree.find(element => element.props?.["aria-haspopup"] === "dialog").props["aria-expanded"], true);
    const choices = tree.filter(element => element.props?.["aria-pressed"] !== undefined);
    assert.deepEqual(choices.map(element => element.key), ["2026-09-09", "2026-09-08", "2026-09-07"]);
    assert.equal(choices[0].props["aria-pressed"], true);
    choices[1].props.onClick();
    assert.deepEqual(h.changes, ["2026-09-08"]);
    assert.equal(h.dialog.open, false);
    assert.equal(h.render().find(element => element.props?.["aria-haspopup"] === "dialog").props["aria-expanded"], false);
    assert.deepEqual(h.dates, ["2026-09-07", "2026-09-08", "2026-09-09"]);
  });

  it("keeps the selected date unchanged on explicit cancellation, backdrop dismissal and native close after Escape", async () => {
    const h = await datePickerHarness();
    h.open().find(element => element.props?.["aria-label"] === "Cancel date selection").props.onClick();
    assert.deepEqual(h.changes, []);
    let tree = h.open();
    const dialogElement = tree.find(element => element.type === "dialog");
    dialogElement.props.onClick({ target: h.dialog, currentTarget: h.dialog });
    assert.equal(h.dialog.open, false);
    assert.deepEqual(h.changes, []);
    h.open();
    // Native Escape closes <dialog>; the component handles its resulting close event.
    h.dialog.close();
    tree = h.render();
    assert.equal(tree.find(element => element.props?.["aria-haspopup"] === "dialog").props["aria-expanded"], false);
    assert.deepEqual(h.changes, []);
    assert.match(tree.find(element => element.props?.["aria-haspopup"] === "dialog").props["aria-label"], /2026\.09\.09/);
  });

  it("expands the FX chart inside its returned parent tree and closes it with focus restored", async () => {
    const hooks = eventHooks();
    const [component] = await importUiWithPorts(["src/components/home/fx-impact-popover.tsx"], { ...copyPorts, react: hooks.react,
      "react-dom": { createPortal: () => { throw new Error("FX detail must remain inside its parent dialog"); } },
    });
    const points = Object.freeze([Object.freeze({ date: "2026-09-08", rate: 1400, ma60: null, ma120: null }), Object.freeze({ date: "2026-09-09", rate: 1410, ma60: null, ma120: null })]);
    const original = structuredClone(points);
    const render = () => { hooks.beginRender(); return component.FxImpactPopover({ compact: true, points, basisDate: "2026-09-08", impactKrw: 10_000, impactPct: 0.2 }); };
    let tree = render();
    assert.equal(elements(tree).some(element => element.type === "section" || element.type === "svg"), false);
    const trigger = elements(tree).find(element => element.props?.["aria-controls"]);
    let focused = false;
    trigger.props.ref.current = { focus() { focused = true; } };
    trigger.props.onClick();
    tree = render();
    const region = elements(tree).find(element => element.type === "section");
    assert.ok(region);
    assert.equal(region.props["aria-label"], "USD/KRW exchange rate trend");
    assert.equal(region.props.id, trigger.props["aria-controls"]);
    assert.ok(tree.props.children.includes(region), "region must be a direct child, not a detached portal");
    assert.ok(elements(region).some(element => element.type === "svg" && element.props.role === "img"));
    assert.ok(elements(region).some(element => element.type === "path" && /^M[^N]* L/.test(element.props.d)));
    assert.deepEqual(points, original);
    elements(region).find(element => element.props?.["aria-label"] === "Close exchange rate trend").props.onClick();
    tree = render();
    assert.equal(focused, true);
    assert.equal(elements(tree).some(element => element.type === "section" || element.type === "svg"), false);
    assert.equal(elements(tree).find(element => element.props?.["aria-controls"]).props["aria-expanded"], false);
    assert.deepEqual(points, original);
  });
});
