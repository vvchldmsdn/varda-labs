import "server-only";
import { sharedExecutionOwnerEnabled } from "../simulation-execution-availability";
import { SimulationPathDetailStore, type PathSnapshot } from "../simulation-path-detail-store";
import type { TenantContext } from "../session-resolver-contract";
import type { SimulationPathHandle } from "../simulation-path-detail";
import { packExecution } from "../simulation-execution-codec";

// Development fixtures only. Private and Production reads never use this store.
const runtime = globalThis as typeof globalThis & { cairnPathDetailsV1?: SimulationPathDetailStore };
const developmentStore = runtime.cairnPathDetailsV1 ??= new SimulationPathDetailStore();
export const simulationPathDetails = {
  async read(owner: string, handle: SimulationPathHandle, pathIndex: number) {
    if (handle.preview && process.env.NODE_ENV === "development") return developmentStore.read(owner, handle, pathIndex);
    if (handle.preview || !sharedExecutionOwnerEnabled(process.env, owner)) return { ok: false as const, status: 503, error: "detail_unavailable" };
    const { readSharedExecution } = await import("@/db/queries/simulation-execution-storage");
    return readSharedExecution(owner, handle, pathIndex);
  },
};
export function registerSimulationPath(owner: string, snapshot: PathSnapshot | null, preview = false) {
  if (!snapshot || !preview || process.env.NODE_ENV !== "development") return undefined;
  return developmentStore.register(owner, snapshot, true);
}
export async function registerTenantSimulationPath(tenantContext: TenantContext, snapshot: PathSnapshot | null): Promise<{ handle?: SimulationPathHandle; notice?: "limit" | "storage" | "disabled" }> {
  if (!snapshot) return {};
  if (!sharedExecutionOwnerEnabled(process.env, tenantContext.ownerUserId)) return { notice: "disabled" };
  try {
    const { saveRenderedExecution, canAdmitSharedExecution, withExecutionDeadline } = await import("@/db/queries/simulation-execution-storage");
    return await withExecutionDeadline(async () => {
      if (!await canAdmitSharedExecution(tenantContext.ownerUserId)) return { notice: "limit" as const };
      const packed = packExecution(tenantContext.ownerUserId, snapshot);
      const saved = await saveRenderedExecution(tenantContext.ownerUserId, packed);
      return saved.status === "ready" ? { handle: saved.handle } : { notice: saved.status === "limit" ? "limit" as const : "storage" as const };
    });
  } catch { return { notice: "storage" }; } // Never fail the financial chart or silently fall back to RAM.
}
