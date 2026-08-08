export const SIMULATION_HISTORY_PROVIDER_DRY_RUN_FLAG =
  "--provider-dry-run";
export const SIMULATION_HISTORY_WRITE_CONFIRMATION =
  "--confirm-shared-history-write";

export type SimulationHistoryCommandMode =
  | "plan_only"
  | "provider_dry_run"
  | "write";

export type SimulationHistoryCommandOptions = Readonly<{
  startDate: string;
  endDate: string;
  mode: SimulationHistoryCommandMode;
}>;

export class SimulationHistoryCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationHistoryCommandInputError";
  }
}

export function parseSimulationHistoryCommandArgs(
  args: readonly string[],
): SimulationHistoryCommandOptions {
  let startDate: string | null = null;
  let endDate: string | null = null;
  let providerDryRun = false;
  let write = false;
  let confirmed = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--from") {
      startDate = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--to") {
      endDate = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === SIMULATION_HISTORY_PROVIDER_DRY_RUN_FLAG) {
      providerDryRun = true;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === SIMULATION_HISTORY_WRITE_CONFIRMATION) {
      confirmed = true;
      continue;
    }
    throw new SimulationHistoryCommandInputError(`unknown argument: ${arg}`);
  }

  if (!startDate || !endDate) {
    throw new SimulationHistoryCommandInputError(
      "Usage: --from YYYY-MM-DD --to YYYY-MM-DD [--provider-dry-run | --write --confirm-shared-history-write]",
    );
  }
  if (providerDryRun && (write || confirmed)) {
    throw new SimulationHistoryCommandInputError(
      "--provider-dry-run cannot be combined with write flags",
    );
  }
  if (write !== confirmed) {
    throw new SimulationHistoryCommandInputError(
      `writes require both --write and ${SIMULATION_HISTORY_WRITE_CONFIRMATION}`,
    );
  }

  return Object.freeze({
    startDate,
    endDate,
    mode: write
      ? "write"
      : providerDryRun
        ? "provider_dry_run"
        : "plan_only",
  });
}
