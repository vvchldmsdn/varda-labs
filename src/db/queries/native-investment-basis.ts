import "server-only";
import { cache } from "react";
import { sqlClient } from "@/db/client";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { readNativeLedger } from "./native-portfolio-ledger";
import { projectInvestmentAccount, investmentKrwEvidence } from "../../lib/native-investment-basis";
import type { FxEvidence } from "../../lib/currency-valuation";

/** Only existing effective owner ledger and stored historical FX. No provider,
 * write, collection, current-FX fallback or client-supplied owner identity. */
export const loadNativeInvestmentBasis = cache(async (tenant: TenantContext, asOf?: string, inclusive = false) => {
  const ledger = await readNativeLedger(tenant);
  if (!ledger.accountsComplete || !ledger.entriesComplete) throw new Error("investment_history_incomplete");
  const at = asOf ?? new Date().toISOString();
  const accounts = ledger.accounts.flatMap(account => {
    if (!account.state) return [];
    const projected = projectInvestmentAccount(account, ledger.entries, { asOf, boundary: inclusive ? "inclusive" : "before" });
    return projected ? [{ accountId: account.id, projected }] : [];
  });
  const times = accounts.flatMap(a => [a.projected.state.startedAt, ...a.projected.state.positions.flatMap(p => p.costLots?.map(l => l.at) ?? []), ...a.projected.entries.map(e => e.data.event.at)]);
  let fx: FxEvidence[] = [];
  if (times.length) {
    const from = new Date(Math.min(...times.map(Date.parse)) - 3 * 86400000).toISOString();
    // Shared FX is read through the same market-data port as native-cutoff-evidence.
    // The owner ledger above remains on the existing tenant transaction/RLS port.
    const result = await sqlClient.query(`select usdkrw::text as rate,observed_at::text as "observedAt",fetched_at::text as "fetchedAt",source,rate_kind as kind
        from fx_rates where not is_sample and status='ok' and rate_kind='daily_reference'
          and observed_at >= $1::timestamptz and observed_at <= $2::timestamptz
        order by observed_at,fetched_at limit 5001`, [from, at]);
    if (result.length > 5000) throw new Error("investment_fx_scope_too_large");
    fx = result.map(row => ({ base: "USD", quote: "KRW", rate: String(row.rate), observedAt: String(row.observedAt), fetchedAt: String(row.fetchedAt), source: String(row.source ?? ""), kind: "daily_reference" }));
  }
  return accounts.map(account => ({ accountId: account.accountId, ...investmentKrwEvidence(account.projected, fx, at) }));
});
