import type { NativeViewDraft } from './recovery-currency';

/** Row-indexed UI choices may only cross a refresh with the same ordered universe. */
export function nativeResearchDraft(saved: NativeViewDraft | null | undefined, defaults: NativeViewDraft, horizons: readonly number[], scenarios: readonly string[]): NativeViewDraft {
  if (!saved || saved.scope !== defaults.scope || saved.view !== defaults.view || saved.currency !== defaults.currency) return defaults;
  const sameRows = saved.instruments?.length === defaults.instruments?.length && saved.instruments?.every((id, index) => id === defaults.instruments?.[index]);
  const horizon = saved.horizon !== undefined && horizons.includes(saved.horizon) ? saved.horizon : defaults.horizon!;
  return { ...defaults, horizon, step: saved.step !== undefined && saved.step <= horizon ? saved.step : horizon,
    scenarioId: saved.scenarioId && scenarios.includes(saved.scenarioId) ? saved.scenarioId : defaults.scenarioId,
    ...(sameRows ? {
      ...(saved.fields?.length === defaults.instruments?.length ? { fields: saved.fields } : {}),
      ...(saved.comparison?.length === defaults.instruments?.length ? { comparison: saved.comparison } : {}),
      ...(saved.selected && /^\d+$/.test(saved.selected) && Number(saved.selected) < (defaults.instruments?.length ?? 0) ? { selected: saved.selected } : {}),
    } : {}),
  };
}
