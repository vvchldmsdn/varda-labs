import "server-only";

import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { sharedExecutionOwnerEnabled } from "@/lib/simulation-execution-availability";
import { deleteStoredSharedExecution, listStoredSharedExecutions } from "@/db/queries/simulation-execution-storage";
import type { SimulationStorageDeleteResult, SimulationStorageListResult } from "@/lib/simulation-storage-management";

export async function listSimulationExecutions(): Promise<SimulationStorageListResult> {
  try {
    const session = await resolveCurrentTenantContext();
    if (!session.ok) return { ok: false, error: "authentication_required" };
    const owner = session.tenantContext.ownerUserId;
    if (!sharedExecutionOwnerEnabled(process.env, owner)) return { ok: false, error: "disabled" };
    return { ok: true, executions: await listStoredSharedExecutions(owner) };
  } catch { return { ok: false, error: "unavailable" }; }
}

export async function deleteSimulationExecution(executionId: unknown): Promise<SimulationStorageDeleteResult> {
  if (typeof executionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(executionId)) return { ok: false, error: "invalid_request" };
  try {
    // Resolve again at click time. Neither a rendered list nor its ID supplies
    // identity; a changed session cannot delete the previous owner's execution.
    const session = await resolveCurrentTenantContext();
    if (!session.ok) return { ok: false, error: "authentication_required" };
    const owner = session.tenantContext.ownerUserId;
    if (!sharedExecutionOwnerEnabled(process.env, owner)) return { ok: false, error: "disabled" };
    return await deleteStoredSharedExecution(owner, executionId) ? { ok: true } : { ok: false, error: "not_found" };
  } catch { return { ok: false, error: "unavailable" }; }
}
