import {
  auditPreviewAuthReadiness,
  inspectLocalAuthEnvironment,
} from "./lib/preview-auth-readiness-audit.mjs";

const result = auditPreviewAuthReadiness({
  root: process.cwd(),
  localEnvironment: inspectLocalAuthEnvironment(process.cwd()),
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
