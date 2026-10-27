export type TwelveDataBudgetPolicy = Readonly<{ httpRequestsPerMinute: number; apiCreditsPerMinute: number; minimumIntervalMs: number }>;
export function assertTwelveDataBudgetPolicy(policy: TwelveDataBudgetPolicy) {
  if (!policy || !Number.isSafeInteger(policy.httpRequestsPerMinute) || policy.httpRequestsPerMinute < 1 || policy.httpRequestsPerMinute > 100_000 ||
      !Number.isSafeInteger(policy.apiCreditsPerMinute) || policy.apiCreditsPerMinute < 1 || policy.apiCreditsPerMinute > 1_000_000 ||
      !Number.isSafeInteger(policy.minimumIntervalMs) || policy.minimumIntervalMs < 0 || policy.minimumIntervalMs > 60_000) throw new Error("twelve_data_budget_policy_invalid");
}
