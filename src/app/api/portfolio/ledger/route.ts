import { createHash } from "node:crypto";
import { releaseOwnerAllowed } from "@/lib/release-admission";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { isSameOriginAuthRequest, readBoundedAuthBody } from "@/lib/auth/auth-request-validation";
import { readNativeLedger, validNativeMutation, writeNativeMutation } from "@/db/queries/native-portfolio-ledger";
import { getTrackedCurrencyEvidence } from "@/db/queries/currency-tracked-portfolio";
import { saveNativeSnapshots } from "@/db/queries/native-portfolio-snapshots";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
async function context() {
  const subject = await readCurrentSessionSubject();
  if (subject.state !== "authenticated") return response({ error: "sign_in_required" }, 401);
  const tenant = await resolveCurrentTenantContext();
  if (!tenant.ok) return response({ error: "account_unavailable" }, tenant.failure.httpStatus);
  return { tenant: tenant.tenantContext, sessionKey: createHash("sha256").update(`native-ledger\0${subject.provider}\0${subject.providerSubject}`).digest("hex") };
}
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return response({ error: "invalid_request" }, 400);
    const auth = await context(); if (auth instanceof Response) return auth;
    const ledger = await readNativeLedger(auth.tenant);
    return response({ sessionKey: auth.sessionKey, accounts: ledger.accounts, canWrite: releaseOwnerAllowed(process.env, "NATIVE_LEDGER", auth.tenant.ownerUserId) });
  } catch { return response({ error: "unavailable" }, 503); }
}
export async function POST(request: Request) {
  try {
    if (new URL(request.url).search || !isSameOriginAuthRequest(request) || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return response({ error: "invalid_request" }, 400);
    let body;
    try { body = JSON.parse(await readBoundedAuthBody(request) ?? "null"); } catch { return response({ error: "invalid_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["sessionKey", "mutation"].includes(key)) || !validNativeMutation(body.mutation)) return response({ error: "invalid_request" }, 400);
    const auth = await context(); if (auth instanceof Response) return auth;
    if (body.sessionKey !== auth.sessionKey) return response({ error: "account_changed" }, 409);
    if (!releaseOwnerAllowed(process.env, "NATIVE_LEDGER", auth.tenant.ownerUserId)) return response({ error: "temporarily_unavailable" }, 503);
    const result = await writeNativeMutation(auth.tenant, body.mutation);
    if (result.status === "invalid") return response({ error: result.reason }, 400);
    if (result.status === "conflict" || result.status === "inactive") return response({ error: result.status }, 409);
    // Ledger success is durable even when a price/FX service cannot capture a valuation.
    // Snapshot capture has its own CAS and never overwrites earlier evidence.
    let snapshot = "unavailable";
    try { snapshot = (await saveNativeSnapshots(auth.tenant, await getTrackedCurrencyEvidence(auth.tenant, { kind: "all", key: "all", label: "All" }, "USD"))).status; } catch { /* no financial payload or credentials in logs */ }
    return response({ status: result.status, snapshot }, result.status === "created" ? 201 : 200);
  } catch { return response({ error: "unavailable" }, 503); }
}
