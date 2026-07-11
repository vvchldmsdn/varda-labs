export const STATIONARY_BOOTSTRAP_POLICY = Object.freeze({
  version: "stationary_bootstrap_v1",
  inputMatrixVersion: "simulation_return_matrix_v1",
  samplingUnit: "whole_return_row",
  startIndex: "uniform",
  restartProbability: "one_over_expected_block_length",
  continuation: "circular_next_index",
  prng: "mulberry32_v1",
  seedSource: "explicit_uint32_only",
  productionDefaults: "forbidden",
  outputKind: "draw_plan_only",
  maxPlannedDraws: 1_000_000,
} as const);

export function isUint32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffff_ffff
  );
}
