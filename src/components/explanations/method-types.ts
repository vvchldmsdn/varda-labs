import type { GuideCopy } from "./calculation-guide-types";

export type MethodTopic = "investment-lab" | "simulation" | "economic-simulation" | "contribution" | "movement" | "risk";

export type MethodFigure =
  | { kind: "flow"; caption: GuideCopy; nodes: readonly { label: GuideCopy; detail: GuideCopy }[] }
  | { kind: "lines"; caption: GuideCopy; xLabel: GuideCopy; yLabel: GuideCopy; series: readonly { label: GuideCopy; values: readonly number[] }[] }
  | { kind: "bars"; caption: GuideCopy; rows: readonly { label: GuideCopy; value: number }[]; unit: GuideCopy };

export type MethodSection = {
  id: string;
  title: GuideCopy;
  lead: GuideCopy;
  equations: readonly { expression: string; reading: GuideCopy }[];
  symbols: readonly { symbol: string; meaning: GuideCopy }[];
  figure: MethodFigure;
  example?: GuideCopy;
  caveat: GuideCopy;
};

export type MethodGuide = {
  title: GuideCopy;
  intro: GuideCopy;
  sections: readonly MethodSection[];
};
