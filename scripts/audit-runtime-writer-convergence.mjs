import { auditRuntimeWriterConvergence } from "./lib/runtime-writer-convergence-audit.mjs";
import { RUNTIME_WRITER_FREEZE_MATRIX } from "../src/lib/runtime-writer-convergence.ts";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const result = auditRuntimeWriterConvergence({
  root: process.cwd(),
  writerRegistry: TENANT_WRITER_REGISTRY,
  freezeMatrix: RUNTIME_WRITER_FREEZE_MATRIX,
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
