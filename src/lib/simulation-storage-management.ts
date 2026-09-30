/** The storage manager receives no portfolio inputs or execution payload. */
export type StoredSimulationExecution = {
  id: string;
  model: "economic" | "bootstrap";
  horizon: number;
  state: "creating" | "ready" | "failed";
  createdAt: number;
  expiresAt: number;
};

export type SimulationStorageError = "authentication_required" | "disabled" | "invalid_request" | "not_found" | "unavailable";
export type SimulationStorageListResult = { ok: true; executions: StoredSimulationExecution[] } | { ok: false; error: SimulationStorageError };
export type SimulationStorageDeleteResult = { ok: true } | { ok: false; error: SimulationStorageError };
