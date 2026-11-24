import {
  canUseFractionalOrders, defaultContributionOrderRule, validContributionOrderRule, withFractionalOrders,
  type ContributionOrderOption, type ContributionOrderRule, type ContributionOrderSettings,
} from "./contribution-order-plan.ts";

type Rules = ContributionOrderSettings["rules"];

// These are broker capabilities confirmed by the user. Cash, fees and budget caps
// belong to the calculation in progress and are never serialized.
export function encodeFractionalPreferences(rules: Rules, options: readonly ContributionOrderOption[]) {
  const entries = options.flatMap(option => {
    const rule = rules[option.key];
    if (!canUseFractionalOrders(option) || !rule || rule.kind === "whole") return [];
    return [[option.key, {kind: rule.kind, step: rule.step, minimum: rule.minimum}]];
  });
  return JSON.stringify(Object.fromEntries(entries));
}

export function decodeFractionalPreferences(raw: string, options: readonly ContributionOrderOption[]): Rules {
  if (!raw) return {};
  try {
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const rules: Record<string, ContributionOrderRule> = {};
    for (const option of options) {
      if (!canUseFractionalOrders(option) || !Object.hasOwn(stored, option.key)) continue;
      const entry = (stored as Record<string, unknown>)[option.key];
      if (!entry || typeof entry !== "object" || !("kind" in entry)) continue;
      const { kind } = entry;
      // Earlier device preferences could enable only fractional selling.
      if (kind === "whole" && "fractionalSell" in entry && entry.fractionalSell === true) {
        rules[option.key] = withFractionalOrders(defaultContributionOrderRule, true);
        continue;
      }
      if (kind !== "fractional-shares" && kind !== "fractional-amount") continue;
      const step = "step" in entry && typeof entry.step === "string" ? entry.step : "";
      const minimum = "minimum" in entry && typeof entry.minimum === "string" ? entry.minimum : "";
      const rule: ContributionOrderRule = {...defaultContributionOrderRule, kind, step, minimum};
      if (validContributionOrderRule(rule, option.currency, option.unit)) rules[option.key] = rule;
    }
    return rules;
  } catch { return {}; }
}
