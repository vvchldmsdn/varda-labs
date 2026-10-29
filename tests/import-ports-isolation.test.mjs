import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "output");

// A child process keeps the probe's copied helper registries away from the main
// suite. Top-level-await gates deterministically overlap the real import hooks.
function overlap(kind) {
  mkdirSync(output, { recursive: true });
  const fixture = mkdtempSync(path.join(output, "port-isolation-test-"));
  try {
    mkdirSync(path.join(fixture, "tests/helpers"), { recursive: true });
    mkdirSync(path.join(fixture, "src"), { recursive: true });
    for (const name of ["import-with-ports.mjs", "import-ui-with-ports.mjs"]) {
      copyFileSync(path.join(root, "tests/helpers", name), path.join(fixture, "tests/helpers", name));
    }
    writeFileSync(path.join(fixture, "src/first.ts"), 'globalThis.startedA = true; await globalThis.portGateA; export const relative = (await import("./dependency")).value; export const alias = (await import("@/dependency")).value;');
    writeFileSync(path.join(fixture, "src/second.ts"), 'globalThis.startedB = true; await globalThis.portGateB; export const value = (await import("@/dependency")).value;');
    writeFileSync(path.join(fixture, "src/view.tsx"), 'globalThis.startedA = true; await globalThis.portGateA; export const value = (await import("./ui-child")).Child().props.children;');
    writeFileSync(path.join(fixture, "src/ui-child.tsx"), 'import styles from "./child.module.css"; export function Child() { return <span className={styles.value}>ui-owned</span>; }');
    writeFileSync(path.join(fixture, "src/child.module.css"), '.value { color: inherit; }');
    const script = [
      'import assert from "node:assert/strict";',
      'import { importWithPorts } from "./tests/helpers/import-with-ports.mjs";',
      'import { importUiWithPorts } from "./tests/helpers/import-ui-with-ports.mjs";',
      'let releaseA, releaseB;',
      'globalThis.portGateA = new Promise(resolve => { releaseA = resolve; });',
      'globalThis.portGateB = new Promise(resolve => { releaseB = resolve; });',
      kind === "ui" ? 'const first = importUiWithPorts(["src/view.tsx"], {});' : 'const first = importWithPorts(["src/first.ts"], {"@/dependency": {value: "first-owned"}});',
      'await new Promise(resolve => setImmediate(resolve)); assert.equal(globalThis.startedA, true);',
      'const second = importWithPorts(["src/second.ts"], {"@/dependency": {value: "second-owned"}});',
      'await new Promise(resolve => setImmediate(resolve)); assert.equal(globalThis.startedB, true);',
      'try {',
      '  releaseA(); const [result] = await first;',
      kind === "ui" ? '  assert.equal(result.value, "ui-owned");' : '  assert.equal(result.relative, "first-owned"); assert.equal(result.alias, "first-owned");',
      '  releaseB(); const [other] = await second; assert.equal(other.value, "second-owned");',
      '} finally { releaseA(); releaseB(); await Promise.allSettled([first, second]); }',
      'console.log("isolated");',
    ].join("\n");
    const result = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-"], { cwd: fixture, input: script, encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /isolated/);
  } finally {
    // Never remove anything outside this exact task-created output directory.
    const relative = path.relative(output, fixture);
    assert.ok(relative.startsWith("port-isolation-test-") && !relative.includes(path.sep) && !path.isAbsolute(relative));
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("overlapping server imports keep both relative and aliased ports in their own registry", () => overlap("server"));
test("a pending server hook cannot redirect another helper's TSX or CSS imports", () => overlap("ui"));
