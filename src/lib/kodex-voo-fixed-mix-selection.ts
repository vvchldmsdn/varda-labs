export const KODEX_VOO_FIXED_MIX_SELECTION_POLICY = Object.freeze({
  version: "fixed_mix_integer_percent_selection_v1",
  defaultKodexWeightPct: 50,
  minimumComponentWeightPct: 1,
  maximumComponentWeightPct: 99,
  totalWeightBps: 10_000,
} as const);

export type KodexVooFixedMixSelection = Readonly<{
  status: "default" | "selected" | "invalid";
  kodexWeightPct: number | null;
  vooWeightPct: number | null;
  kodexWeightBps: number | null;
  vooWeightBps: number | null;
  reason: "ambiguous_query" | "invalid_format" | "out_of_range" | null;
}>;

export function resolveKodexVooFixedMixSelection(
  value: string | readonly string[] | undefined,
): KodexVooFixedMixSelection {
  if (value === undefined) {
    return validSelection(
      "default",
      KODEX_VOO_FIXED_MIX_SELECTION_POLICY.defaultKodexWeightPct,
    );
  }
  if (typeof value !== "string") {
    return invalidSelection("ambiguous_query");
  }
  if (!/^(?:0|[1-9][0-9]{0,2})$/.test(value)) {
    return invalidSelection("invalid_format");
  }

  const kodexWeightPct = Number(value);
  if (
    kodexWeightPct <
      KODEX_VOO_FIXED_MIX_SELECTION_POLICY.minimumComponentWeightPct ||
    kodexWeightPct >
      KODEX_VOO_FIXED_MIX_SELECTION_POLICY.maximumComponentWeightPct
  ) {
    return invalidSelection("out_of_range");
  }
  return validSelection("selected", kodexWeightPct);
}

function validSelection(
  status: "default" | "selected",
  kodexWeightPct: number,
): KodexVooFixedMixSelection {
  const vooWeightPct = 100 - kodexWeightPct;
  return Object.freeze({
    status,
    kodexWeightPct,
    vooWeightPct,
    kodexWeightBps: kodexWeightPct * 100,
    vooWeightBps: vooWeightPct * 100,
    reason: null,
  });
}

function invalidSelection(
  reason: Exclude<KodexVooFixedMixSelection["reason"], null>,
): KodexVooFixedMixSelection {
  return Object.freeze({
    status: "invalid",
    kodexWeightPct: null,
    vooWeightPct: null,
    kodexWeightBps: null,
    vooWeightBps: null,
    reason,
  });
}
