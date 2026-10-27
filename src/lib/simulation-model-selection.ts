export type SimulationPathModel = "economic" | "bootstrap";

export function resolveSimulationPathModel(value: string | readonly string[] | undefined): SimulationPathModel | null {
  if (value === undefined || value === "economic") return "economic";
  return value === "bootstrap" ? "bootstrap" : null;
}
