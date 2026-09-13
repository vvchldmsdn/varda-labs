import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { QUICK_STORAGE_KEY } from "../src/lib/quick-portfolio.ts";

describe("plan to holding handoff", () => {
  it("reads only a valid expiring draft and passes only its name on an explicit click", async () => {
    let raw = JSON.stringify({ version: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expiresAt: Date.now() + 60000,
      input: { currency: "KRW", rows: [{ name: "My ETF", value: 5000, instrumentId: null }] } });
    const storage = globalThis.localStorage;
    globalThis.localStorage = { getItem: key => { assert.equal(key, QUICK_STORAGE_KEY); return raw; } };
    try {
      const [reference] = await importUiWithPorts(["src/components/first-visit/quick-holding-reference.tsx"], {
        react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
        "next/link": { default: () => null },
        "@/components/i18n/locale-provider": { useI18n: () => ({ t: ko => ko }) },
      });
      const searches = [];
      const tree = reference.QuickHoldingReference({ disabled: false, onSearch: name => searches.push(name) });
      const walk = node => node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];
      const button = walk(tree).find(node => node.type === "button");
      assert.deepEqual(searches, []);
      button.props.onClick();
      assert.deepEqual(searches, ["My ETF"]);
      assert.equal(walk(tree).some(node => node.type === "input"), false);
      raw = "malformed";
      assert.equal(walk(reference.QuickHoldingReference({ disabled: false, onSearch() {} })).some(node => node.type === "button"), false);
      raw = JSON.stringify({ version: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expiresAt: Date.now() - 1,
        input: { currency: "KRW", rows: [{ name: "Expired", value: 5000, instrumentId: null }] } });
      assert.equal(walk(reference.QuickHoldingReference({ disabled: false, onSearch() {} })).some(node => node.type === "button"), false);
    } finally { globalThis.localStorage = storage; }
  });

});
