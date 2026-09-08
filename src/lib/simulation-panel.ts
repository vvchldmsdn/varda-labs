export type SimulationPanel = "weights" | "validation" | "evidence";

export function resolveSimulationPanel(value: unknown): SimulationPanel | null {
  return value === "weights" || value === "validation" || value === "evidence"
    ? value
    : null;
}
