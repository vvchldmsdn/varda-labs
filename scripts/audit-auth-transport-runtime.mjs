import { auditAuthTransportRuntime } from "./lib/auth-transport-runtime-audit.mjs";

const result = auditAuthTransportRuntime(process.cwd());
console.log(JSON.stringify(result, null, 2));

if (result.status !== "passed") process.exitCode = 1;
