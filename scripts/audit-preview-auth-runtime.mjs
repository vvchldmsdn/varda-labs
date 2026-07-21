import { auditPreviewAuthRuntime } from "./lib/preview-auth-runtime-audit.mjs";

const result = auditPreviewAuthRuntime(process.cwd());
console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
