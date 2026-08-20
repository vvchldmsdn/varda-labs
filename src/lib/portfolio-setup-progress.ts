export const PORTFOLIO_SETUP_POLICY = Object.freeze({
  version: "empty_portfolio_setup_v1",
  totalSteps: 3,
} as const);

export type PortfolioSetupStepStatus = "complete" | "current" | "pending";

export type PortfolioSetupProgress = Readonly<{
  completedStepCount: number;
  isComplete: boolean;
  nextAction: Readonly<{ href: string; label: string }>;
  steps: readonly Readonly<{
    id: "portfolio" | "account" | "holding";
    label: string;
    status: PortfolioSetupStepStatus;
  }>[];
}>;

export function derivePortfolioSetupProgress({
  activeAccountCount,
  activeHoldingCount,
}: {
  activeAccountCount: number;
  activeHoldingCount: number;
}): PortfolioSetupProgress {
  const hasAccount = activeAccountCount > 0;
  const hasHolding = hasAccount && activeHoldingCount > 0;
  const completedStepCount = 1 + Number(hasAccount) + Number(hasHolding);

  return Object.freeze({
    completedStepCount,
    isComplete: hasAccount && hasHolding,
    nextAction: Object.freeze(
      !hasAccount
        ? { href: "#create-account", label: "Create first account" }
        : !hasHolding
          ? { href: "/portfolio/holdings/new", label: "Add first holding" }
          : { href: "/", label: "Open dashboard" },
    ),
    steps: Object.freeze([
      step("portfolio", "Portfolio created", "complete"),
      step(
        "account",
        "Custody account created",
        hasAccount ? "complete" : "current",
      ),
      step(
        "holding",
        "First holding added",
        hasHolding ? "complete" : hasAccount ? "current" : "pending",
      ),
    ]),
  });
}

function step(
  id: PortfolioSetupProgress["steps"][number]["id"],
  label: string,
  status: PortfolioSetupStepStatus,
) {
  return Object.freeze({ id, label, status });
}
