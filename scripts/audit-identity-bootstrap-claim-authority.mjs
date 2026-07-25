import { auditIdentityBootstrapClaimAuthority } from "./lib/identity-bootstrap-claim-authority-audit.mjs";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const result = auditIdentityBootstrapClaimAuthority({
  root: process.cwd(),
  writerRegistry: TENANT_WRITER_REGISTRY,
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
