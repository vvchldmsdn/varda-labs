/** Opt-in numeric diagnostics only: never SQL, parameters, rows, cookies or owners.
 * JSON byte size is an application estimate, NOT Neon's billed wire traffic. */
export async function measureDatabaseRead<T>(
  name: "tenant.transaction" | "market.history.signature" | "market.history.rows",
  read: () => Promise<T>,
): Promise<T> {
  if (process.env.CAIRN_DB_READ_METRICS_ENABLED !== "true") return read();
  const start = performance.now();
  try {
    const value = await read();
    try {
      const groups = Array.isArray(value) ? value : [];
      const rows = groups.reduce((total, row) => total + (Array.isArray(row) ? row.length : 1), 0);
      console.info(JSON.stringify({ event: "cairn_db_read", name, ok: true,
        rows, estimatedResultBytes: Buffer.byteLength(JSON.stringify(value) ?? "", "utf8"),
        durationMs: Math.round(performance.now() - start) }));
    } catch { /* Metrics must never change a successful read. */ }
    return value;
  } catch (error) {
    try {
      console.info(JSON.stringify({ event: "cairn_db_read", name, ok: false,
        durationMs: Math.round(performance.now() - start) }));
    } catch { /* Keep the original read error. */ }
    throw error;
  }
}
