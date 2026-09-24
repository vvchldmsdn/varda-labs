import { calculateCurrencyContribution, type CurrencyContributionInput, type ContributionMoneyEvidence } from "./currency-contribution.ts";
import { Decimal, isCurrency, parseMoneyInput, type Currency } from "./money.ts";

export type NativeContributionContext = {
  status: "ready"; scopeKey: string; scopeLabel: string;
  policy: { version: string; revision: number; universeHash: string; vectorHash: string; effectiveServiceDate: string };
  input: Omit<CurrencyContributionInput, "funds">;
  availableCash: ContributionMoneyEvidence[];
  nativeSequences: Readonly<Record<string, number>>;
  names: Record<string, string>;
};
export type NativeContributionContextResult = NativeContributionContext | { status: "blocked"; reason: string };
export type NativeContributionRequest = { id: string; scopeKey: string; reportingCurrency: Currency; newMoney: { amount: string; currency: Currency }; useAvailableCash: boolean };
export type NativeContributionDocument = { version: "native_contribution_plan_v1"; request: NativeContributionRequest; basis: NativeContributionContext; result: Extract<ReturnType<typeof calculateCurrencyContribution>, { status: "ready" }> };
export type SavedNativeContributionPlan = { id: string; createdAt: string; document: NativeContributionDocument };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isNativeContributionPlanId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
export function validNativeContributionRequest(value: unknown): value is NativeContributionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as NativeContributionRequest;
  return Object.keys(v).every(key => ["id", "scopeKey", "reportingCurrency", "newMoney", "useAvailableCash"].includes(key)) && UUID.test(v.id ?? "") && typeof v.scopeKey === "string" && (v.scopeKey === "all" || /^(account|portfolio):/.test(v.scopeKey) && UUID.test(v.scopeKey.split(":")[1]) && v.scopeKey.split(":").length === 2) && isCurrency(v.reportingCurrency) && typeof v.useAvailableCash === "boolean" && !!v.newMoney && typeof v.newMoney === "object" && Object.keys(v.newMoney).every(key => ["amount", "currency"].includes(key)) && isCurrency(v.newMoney.currency) && typeof v.newMoney.amount === "string" && v.newMoney.amount.length <= 24 && /^\d+(?:\.\d+)?$/.test(v.newMoney.amount) && parseMoneyInput(v.newMoney.amount, v.newMoney.currency) !== null && Decimal.from(v.newMoney.amount).compare(0) >= 0;
}
export function buildNativeContributionPlan(context: NativeContributionContextResult, request: NativeContributionRequest) {
  if (!validNativeContributionRequest(request)) return { status: "blocked" as const, reason: "invalid_request" };
  if (context.status !== "ready") return context;
  if (context.scopeKey !== request.scopeKey || context.input.reportingCurrency !== request.reportingCurrency) return { status: "blocked" as const, reason: "context_mismatch" };
  const amount = Decimal.from(request.newMoney.amount);
  const funds: ContributionMoneyEvidence[] = [
    ...(amount.compare(0) > 0 ? [{ amount: amount.toExactString(), currency: request.newMoney.currency, at: context.input.asOf, source: "user_new_contribution", kind: "new_money" as const }] : []),
    ...(request.useAvailableCash ? context.availableCash : []),
  ];
  // Zero new cash still permits a funded rebalance from actual profitable sales.
  if (!funds.length) funds.push({ amount: "0", currency: request.newMoney.currency, at: context.input.asOf, source: "user_new_contribution", kind: "new_money" });
  const result = calculateCurrencyContribution({ ...context.input, funds });
  if (result.status !== "ready") return result;
  return { status: "ready" as const, document: { version: "native_contribution_plan_v1" as const, request, basis: context, result } };
}
