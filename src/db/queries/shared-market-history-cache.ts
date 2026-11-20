import "server-only";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { sqlClient } from "@/db/client";
import { measureDatabaseRead } from "@/lib/database-read-metrics";

type PublicHistory = "instrument-price-history" | "fx-history";
type HistoryQuery<T> = PromiseLike<T[]> & { toSQL(): { sql: string; params: unknown[] } };
class HistoryChanged extends Error {}

/**
 * Only public instrument/FX projections belong here, never holdings, raw import
 * evidence, owner data or a personalized result. Call AFTER the caller's existing
 * session/scope admission. SQL projection must have unique output column names.
 *
 * A small content signature is read on every request. Thus corrections, deletes,
 * restored historical rows and out-of-band writes invalidate without relying on
 * every writer to remember a cache tag. This trades DB aggregation CPU for egress;
 * measure both before broadening beyond the bounded research history queries.
 */
export async function readSharedMarketHistory<T>(
  source: PublicHistory,
  query: HistoryQuery<T>,
): Promise<T[]> {
  const compiled = query.toSQL();
  const identity = createHash("sha256").update(source).update(compiled.sql)
    .update(JSON.stringify(compiled.params)).digest("hex");
  // Order-independent signature includes every selected value, including nulls.
  const signatureSql = `select md5(coalesce(
    jsonb_agg(to_jsonb(evidence) order by to_jsonb(evidence)::text)::text, '[]'
  )) as signature from (${compiled.sql}) evidence`;
  const signature = async () => {
    const rows = await measureDatabaseRead("market.history.signature",
      () => sqlClient.query(signatureSql, compiled.params));
    const value = rows[0]?.signature;
    if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value))
      throw new Error("market_history_signature_unavailable");
    return value;
  };
  const read = () => measureDatabaseRead("market.history.rows", async () => await query);
  // No stale-on-error fallback: unavailable evidence must stay unavailable.
  const before = await signature();
  let sourceError: unknown;
  try {
    return await unstable_cache(async () => {
      try {
        const rows = await read();
        if (await signature() !== before) throw new HistoryChanged();
        return rows;
      } catch (error) { sourceError = error; throw error; }
    }, ["cairn-public-history-v1", identity, before], { revalidate: 3600 })();
  } catch (error) {
    // A concurrent correction must not poison the old content-addressed entry.
    // Return a fresh statement result; do not cache it until the next stable read.
    if (error instanceof HistoryChanged) return read();
    if (sourceError === error) throw error;
    // Cache infrastructure is optional. A cache failure can use a new DB read,
    // never an old result. Also supports existing scripts outside Next runtime.
    return read();
  }
}
