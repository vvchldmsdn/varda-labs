import "server-only";
import { buildTrackedCurrencyPortfolio, type CurrencyTrackedInput, type CurrencyTrackedResult } from "@/lib/currency-tracked-portfolio";
import type { Currency } from "@/lib/money";

/** Only call after the tenant-scoped evidence loader. Evaluate the unchanged
 * financial/time guards on the server, never against the browser's wall clock.
 * Both reports belong to this exact evidence snapshot; no shared result cache.
 */
export function buildTrackedCurrencyReports(evidence: CurrencyTrackedInput): Readonly<Record<Currency, CurrencyTrackedResult>> {
  return {
    KRW: buildTrackedCurrencyPortfolio({ ...evidence, reporting: "KRW" }),
    USD: buildTrackedCurrencyPortfolio({ ...evidence, reporting: "USD" }),
  };
}
