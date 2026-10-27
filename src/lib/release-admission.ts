/** Rollout is independent of language/currency. Existing reads remain available. */
export function releaseOwnerAllowed(env: Record<string, string | undefined>, feature: "NATIVE_LEDGER" | "SIMULATION_EXECUTION", owner: string) {
  const mode = env[`${feature}_ROLLOUT`];
  if (mode === "all") return true;
  if (mode !== "qa" || !/^[0-9a-f-]{36}$/i.test(owner)) return false;
  return (env[`${feature}_QA_OWNERS`] ?? "").split(",").map(value => value.trim()).filter(value => /^[0-9a-f-]{36}$/i.test(value)).includes(owner);
}
