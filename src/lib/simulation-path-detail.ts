/** Public, bounded DTOs only. Never add full execution buffers to this module. */
export type SimulationPathHandle = Readonly<{
  executionId: string;
  binding: string;
  currency: "KRW" | "USD";
  model: "economic" | "bootstrap";
  preview: boolean;
  expiresAt: number;
}>;

export type SimulationPathDetail = {
  executionId: string;
  pathIndex: number;
  model: "economic" | "bootstrap";
  modelVersion: string;
  currency: "KRW" | "USD";
  seed: number;
  horizon: number;
  coveragePct: number;
  portfolio: number[];
  finalReturnPct: number;
  maxDrawdownPct: number;
  assets: { key: string; label: string; weightBps: number; values: number[]; returns: (number | null)[] }[];
  factors: { key: string; label: string; unit: string; observationDate: string; source: string; values: number[] }[];
  draws: { step: number; from: string; to: string; blockStart: boolean }[];
};
