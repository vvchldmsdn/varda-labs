import { createHash } from "node:crypto";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { readNativeLedgerRecords } from "@/db/queries/native-ledger-records";
import { NATIVE_RECORD_ID } from "@/lib/native-ledger-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });

/** Separate read route: the mutation endpoint's recovery and import contracts stay intact. */
export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams, accountId = search.get("accountId");
    if (search.size !== 1 || !accountId || !NATIVE_RECORD_ID.test(accountId)) return response({ error: "invalid_request" }, 400);
    const subject = await readCurrentSessionSubject();
    if (subject.state !== "authenticated") return response({ error: "sign_in_required" }, 401);
    const tenant = await resolveCurrentTenantContext();
    if (!tenant.ok) return response({ error: "account_unavailable" }, tenant.failure.httpStatus);
    const result = await readNativeLedgerRecords(tenant.tenantContext, accountId);
    if (result.state !== "ready") return response({ error: result.state === "not_found" ? "account_unavailable" : "unavailable" }, result.state === "not_found" ? 404 : 503);
    const sessionKey = createHash("sha256").update(`native-ledger\0${subject.provider}\0${subject.providerSubject}`).digest("hex");
    return response({ ...result, sessionKey });
  } catch { return response({ error: "unavailable" }, 503); }
}
