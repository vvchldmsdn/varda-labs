import assert from "node:assert/strict";
import { it } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { simulationReturnTone } from "../src/components/simulation/simulation-presentation.ts";

it("return tones distinguish gain, loss, zero and unavailable values", () => {
  for (const [value, expected] of [[2,"positive"],[-4.5,"negative"],[0,"neutral"],[-0,"neutral"],[null,"neutral"],[undefined,"neutral"],[NaN,"neutral"]]) assert.equal(simulationReturnTone(value), expected);
});
it("public introduction and contribution preserve verified-session navigation", async () => {
  let state = "authenticated";
  const Public = () => null;
  const [start,tryPage] = await importUiWithPorts(["src/app/start/page.tsx","src/app/try/page.tsx"], {
    "@/lib/i18n/server": { localizedMetadata: () => ({}) },
    "@/lib/auth/current-session-subject": { readCurrentSessionSubject: async () => ({state}) },
    "@/components/first-visit/public-nav": { PublicNav: Public },
    "@/components/first-visit/product-film": { ProductFilm: () => null },
    "@/components/first-visit/entry-event": { EntryEvent: () => null },
    "@/components/first-visit/plan-experience": { PlanExperience: () => null },
    "@/components/i18n/localized-text": { T: () => null },
    "@/components/i18n/localized-element": { LocalizedElement: () => null },
    "@/components/i18n/language-switch": { LanguageSwitch: () => null },
    "@/components/brand-logo": { BrandLogo: () => null },
    "next/link": { default: () => null },
  });
  const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree,...nodes(tree.props?.children)];
  for (const signedIn of [true,false]) {
    state=signedIn?"authenticated":"unauthenticated";
    const home=nodes(await start.default());
    assert.equal(home.some(n=>n.props?.href==="/auth/sign-in"),!signedIn);
    assert.equal(home.some(n=>n.props?.href==="/"),signedIn);
    const trial=nodes(await tryPage.default({searchParams:Promise.resolve({mode:"personal"})}));
    assert.equal(trial.find(n=>n.type===Public).props.signedIn,signedIn);
  }
});
it("plans use application navigation for verified sessions and the public shell for guests", async () => {
  let state = "authenticated";
  const App = () => null, Public = () => null, Library = () => null;
  const [route] = await importUiWithPorts(["src/app/plans/page.tsx"], {
    "@/lib/i18n/server": { localizedMetadata: () => ({}) },
    "@/lib/auth/current-session-subject": { readCurrentSessionSubject: async () => ({ state }) },
    "@/lib/auth/auth-transport-runtime": { getAuthTransportRuntimeState: () => ({state:"ready"}) },
    "@/components/secondary-page-header": { SecondaryPageHeader: App },
    "@/components/first-visit/public-nav": { PublicNav: Public },
    "@/components/first-visit/plan-libraries": { PlanLibraries: Library },
  });
  const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  let tree = nodes(await route.default());
  assert.ok(tree.some(node => node.type === App));
  assert.ok(!tree.some(node => node.type === Public));
  assert.equal(tree.find(node => node.type === Library).props.showTour, false);
  state = "unauthenticated";
  tree = nodes(await route.default());
  assert.ok(tree.some(node => node.type === Public));
  assert.ok(!tree.some(node => node.type === App));
});
