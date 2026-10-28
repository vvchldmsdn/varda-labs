import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { financialFiles, verifyFinancialDomain } from "./verify-financial-domain.mjs";

const tempParent = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(tempParent, "cairn-financial-domain-test-"));
const canonical = path.join(root, "packages/cairn-financial-domain/src");
const generated = path.join(root, "src/lib");
fs.mkdirSync(canonical, { recursive: true });
fs.mkdirSync(generated, { recursive: true });
try {
  for (const file of financialFiles) {
    fs.writeFileSync(path.join(canonical, file), "export const original = 1;\n");
    fs.writeFileSync(path.join(generated, file), "export const original = 1;\n");
  }
  verifyFinancialDomain(root, { sync: true });
  verifyFinancialDomain(root);

  const first = financialFiles[0], last = financialFiles.at(-1);
  fs.writeFileSync(path.join(canonical, first), "export const reviewed = 2;\n");
  assert.throws(() => verifyFinancialDomain(root), /divergence/);
  fs.writeFileSync(path.join(generated, last), "export const userEdit = 3;\n");
  assert.throws(() => verifyFinancialDomain(root, { sync: true }), /Refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(generated, first), "utf8"), "export const original = 1;\n");
  assert.equal(fs.readFileSync(path.join(generated, last), "utf8"), "export const userEdit = 3;\n");

  fs.writeFileSync(path.join(canonical, last), "export const userEdit = 3;\n");
  verifyFinancialDomain(root, { sync: true });
  verifyFinancialDomain(root);
  assert.equal(fs.readFileSync(path.join(generated, first), "utf8"), "export const reviewed = 2;\n");

  const manifest = path.join(generated, "shared-financial-domain.manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, authority: "../outside", files: {} }));
  assert.throws(() => verifyFinancialDomain(root, { sync: true }), /Invalid/);
  console.log("PASS: canonical edits, changed-consumer protection, all-files preflight, reviewed reconciliation and manifest validation.");
} finally {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== tempParent || !path.basename(resolved).startsWith("cairn-financial-domain-test-")) throw new Error("Unsafe test cleanup path");
  fs.rmSync(resolved, { recursive: true });
}
