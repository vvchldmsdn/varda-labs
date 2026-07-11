import { auditInitialIdentityLinkPlanner } from "./lib/initial-identity-link-planner-audit.mjs";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const result = auditInitialIdentityLinkPlanner({
  root: process.cwd(),
  writerRegistry: TENANT_WRITER_REGISTRY,
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
