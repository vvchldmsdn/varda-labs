import "server-only";
import type { TwelveDataEndpoint } from "./twelve-data-contract";

/** The only external I/O boundary; fixture tests replace this module, never persistence or provenance. */
export async function fetchTwelveDataPayload(endpoint: TwelveDataEndpoint, parameters: Readonly<Record<string, string>>, apiKey: string): Promise<unknown> {
  if (!["/quote", "/time_series", "/exchange_rate", "/splits", "/dividends"].includes(endpoint) || !apiKey.trim()) throw new Error("twelve_data_transport_input_invalid");
  const url = new URL(endpoint, "https://api.twelvedata.com");
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
    if (response.status === 429) throw new Error("twelve_data_rate_limited");
    if (response.status === 401 || response.status === 403) throw new Error("twelve_data_auth_failed");
    if (!response.ok) throw new Error("twelve_data_transport_failed");
    if (!response.body) throw new Error("twelve_data_payload_invalid");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let bytes = 0, content = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2_000_000) { await reader.cancel(); throw new Error("twelve_data_payload_too_large"); }
        content += decoder.decode(value, { stream: true });
      }
      return JSON.parse(content + decoder.decode()) as unknown;
    } finally { reader.releaseLock(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new Error(/^twelve_data_[a-z_]+$/.test(message) ? message : "twelve_data_transport_failed");
  }
}
