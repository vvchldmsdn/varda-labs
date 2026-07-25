import { auditIdentityPairingAuthority } from "./lib/identity-pairing-authority-audit.mjs";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const result = auditIdentityPairingAuthority({
  root: process.cwd(),
  writerRegistry: TENANT_WRITER_REGISTRY,
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
