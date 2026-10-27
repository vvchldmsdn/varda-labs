"use server";

import { listSimulationExecutions as listStored, deleteSimulationExecution as deleteStored } from "@/lib/server/simulation-storage-management";

export async function listSimulationExecutions() {
  return listStored();
}

export async function deleteSimulationExecution(executionId: unknown) {
  return deleteStored(executionId);
}
