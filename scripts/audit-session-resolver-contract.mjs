import { auditSessionResolverContract } from "./lib/session-resolver-contract-audit.mjs";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const result = auditSessionResolverContract({
  root: process.cwd(),
  writerRegistry: TENANT_WRITER_REGISTRY,
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
