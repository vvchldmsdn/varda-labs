import type { SimulationTerminalDownsideTailPolicy } from "./simulation-terminal-downside-tail-policy.ts";

export type SimulationTerminalDownsideTailBlockerReason =
  | "invalid_input_shape"
  | "invalid_path_count"
  | "invalid_terminal_return"
  | "invalid_p5_return"
  | "invalid_tail_mean_return";

export type SimulationTerminalDownsideTailBlocker = Readonly<{
  reason: SimulationTerminalDownsideTailBlockerReason;
}>;

export type SimulationTerminalDownsideTailInput = Readonly<{
  terminalReturns: readonly number[];
}>;

export type SimulationTerminalDownsideTailReadyResult = Readonly<{
  summaryStatus: "ready";
  runtimeTrustStatus: "not_established";
  policy: SimulationTerminalDownsideTailPolicy;
  pathCount: 500;
  tailPathCount: 25;
  p5TerminalReturn: number;
  lowerTailMeanTerminalReturn: number;
  blockers: readonly [];
}>;

export type SimulationTerminalDownsideTailBlockedResult = Readonly<{
  summaryStatus: "blocked";
  runtimeTrustStatus: "not_established";
  policy: SimulationTerminalDownsideTailPolicy;
  pathCount: 0;
  tailPathCount: 0;
  p5TerminalReturn: null;
  lowerTailMeanTerminalReturn: null;
  blockers: readonly SimulationTerminalDownsideTailBlocker[];
}>;

export type SimulationTerminalDownsideTailResult =
  | SimulationTerminalDownsideTailReadyResult
  | SimulationTerminalDownsideTailBlockedResult;

export type SimulationTerminalDownsideTailValidationResult = Readonly<{
  terminalReturns: readonly number[] | null;
  blockers: readonly SimulationTerminalDownsideTailBlocker[];
}>;
