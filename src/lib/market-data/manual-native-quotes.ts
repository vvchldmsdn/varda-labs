import "server-only";
import { createHash } from "node:crypto";
import { getTwelveDataServerConfig, readTwelveDataEvidence, requestTwelveDataEvidence, resolveTwelveDataTarget } from "./twelve-data-service";

/** Only the authenticated refresh handler supplies owned targets. Polling reads;
 * it never creates demand. Licensing, identity, freshness and budgets stay in the service. */
export async function manualNativeQuotes(targets: readonly { ticker: string; market: string; currency: string }[], collect: boolean) {
  const config = getTwelveDataServerConfig();
  if (!config || config.provider.audience !== "member_display") return { available: false, pending: false, failed: false, version: "disabled" };
  const at = new Date().toISOString();
  const resolved = targets.map(target => resolveTwelveDataTarget(target, config)).flatMap(row => row.status === "resolved" ? [row.target] : []);
  const unique = [...new Map(resolved.map(target => [target.key, target])).values()];
  const read = collect ? requestTwelveDataEvidence : readTwelveDataEvidence;
  const settled = await Promise.allSettled([
    ...unique.map(target => read({ kind: "live", target, asOf: at, knownAt: at }, config)),
    // KRW-only holdings and cash-only accounts can also be viewed in USD.
    read({ kind: "fx", asOf: at, knownAt: at }, config),
  ]);
  const results = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const failed = settled.some(result => result.status === "rejected");
  return {
    failed,
    available: results.some(result => result.status !== "disabled"),
    pending: results.some(result => result.status === "missing" || result.status === "stale" || result.status === "admitted" && result.refreshDue),
    version: createHash("sha256").update(JSON.stringify([failed, results.map(result => [result.status, result.prices, result.fx])])).digest("hex"),
  };
}
