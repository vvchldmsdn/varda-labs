import { createHash, randomUUID } from "node:crypto";
import type { SimulationPathDetail, SimulationPathHandle } from "./simulation-path-detail.ts";

export const PATH_DETAIL_LIMITS = Object.freeze({ paths: 1000, assets: 64, factors: 3, horizon: 126, bytes: 96 * 1024 * 1024, entries: 8, perOwner: 2, ttlMs: 10 * 60 * 1000, responseBytes: 512 * 1024 });
export type PathSnapshot = {
  model: "economic" | "bootstrap"; modelVersion: string; currency: "KRW" | "USD";
  seed: number; horizon: number; pathCount: number; provenance: string; coveragePct: number;
  assets: { key: string; label: string; weightBps: number }[];
  /** Exact engine growth, path-major, step-major, asset-major. */
  growth: Float64Array; chart: Float64Array;
  factors: { key: string; label: string; unit: string; transform: string; observationDate: string; source: string }[];
  states: Float64Array;
  /** The actual draw, not a newly seeded draw. -1 at step zero. */
  drawRows: Int32Array; blockStarts: Uint8Array;
  history: { from: string; to: string; returns: number[] }[];
};
type Entry = { owner: string; handle: SimulationPathHandle; snapshot: PathSnapshot; bytes: number };
export type PathReadResult = { ok: true; detail: SimulationPathDetail } | { ok: false; status: number; error: string };

/** Process-local, TTL + byte + entry bounded. A miss never re-runs a simulation. */
export class SimulationPathDetailStore {
  private entries = new Map<string, Entry>();
  private now: () => number;
  private byteLimit: number;
  constructor(now: () => number = Date.now, byteLimit = PATH_DETAIL_LIMITS.bytes) { this.now = now; this.byteLimit = byteLimit; }
  private prune() { for (const [key, entry] of this.entries) if (entry.handle.expiresAt <= this.now()) this.entries.delete(key); }
  get retainedBytes() { this.prune(); return [...this.entries.values()].reduce((sum, e) => sum + e.bytes, 0); }
  register(owner: string, input: PathSnapshot, preview = false): SimulationPathHandle | undefined {
    this.prune();
    const { horizon: h, pathCount: p, assets: a, factors: f } = input;
    if (!owner || !Number.isInteger(h) || h < 1 || h > PATH_DETAIL_LIMITS.horizon || !Number.isInteger(p) || p < 1 || p > PATH_DETAIL_LIMITS.paths || !a.length || a.length > PATH_DETAIL_LIMITS.assets || f.length > PATH_DETAIL_LIMITS.factors || !Number.isSafeInteger(input.seed) || !Number.isFinite(input.coveragePct) || input.coveragePct < 0 || input.coveragePct > 100 || !input.modelVersion || input.provenance.length > 8192) return;
    if (new Set(a.map(row => row.key)).size !== a.length || a.some(row => !row.key || row.key.length > 160 || row.label.length > 240 || !Number.isInteger(row.weightBps) || row.weightBps < 0) || a.reduce((sum, row) => sum + row.weightBps, 0) !== 10000) return;
    if (input.growth.length !== p * (h + 1) * a.length || input.chart.length !== p * (h + 1) || input.states.length !== p * (h + 1) * f.length) return;
    if (input.model === "bootstrap" && (f.length || input.drawRows.length !== p * (h + 1) || input.blockStarts.length !== input.drawRows.length || !input.history.length || input.history.length > 2000)) return;
    if (input.model === "economic" && (input.drawRows.length || input.history.length || input.blockStarts.length)) return;
    if (input.history.some(row => row.returns.length !== a.length || row.returns.some(value => !Number.isFinite(value) || value <= -1))) return;
    if (f.some(row => Object.values(row).some(value => value.length > 240))) return;
    const metadata = { ...input, growth: undefined, chart: undefined, states: undefined, drawRows: undefined, blockStarts: undefined };
    const buffers = [input.growth, input.chart, input.states, input.drawRows, input.blockStarts];
    const metadataJson = JSON.stringify(metadata);
    // Includes JS metadata overhead, in addition to exact typed-buffer storage.
    const bytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0) + Buffer.byteLength(metadataJson) * 4 + 4096;
    if (bytes > this.byteLimit) return;
    for (const buffer of [input.growth, input.chart, input.states]) for (const value of buffer) if (!Number.isFinite(value)) return;
    const hash = createHash("sha256").update(owner).update(metadataJson);
    for (const buffer of buffers) hash.update(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    const binding = hash.digest("hex");
    // An exact duplicate render can reuse the immutable original, not reset its TTL.
    for (const entry of this.entries.values()) if (entry.owner === owner && entry.handle.binding === binding && entry.handle.preview === preview) return entry.handle;
    while ([...this.entries.values()].filter(e => e.owner === owner).length >= PATH_DETAIL_LIMITS.perOwner) {
      const first = [...this.entries].find(([, e]) => e.owner === owner)!; this.entries.delete(first[0]);
    }
    while (this.entries.size >= PATH_DETAIL_LIMITS.entries || this.retainedBytes + bytes > this.byteLimit) this.entries.delete(this.entries.keys().next().value!);
    const snapshot: PathSnapshot = { ...JSON.parse(metadataJson), growth: input.growth.slice(), chart: input.chart.slice(), states: input.states.slice(), drawRows: input.drawRows.slice(), blockStarts: input.blockStarts.slice() };
    const handle: SimulationPathHandle = Object.freeze({ executionId: randomUUID(), binding, currency: input.currency, model: input.model, preview, expiresAt: this.now() + PATH_DETAIL_LIMITS.ttlMs });
    this.entries.set(handle.executionId, { owner, handle, snapshot, bytes });
    return handle;
  }
  read(owner: string, handle: SimulationPathHandle, pathIndex: number): PathReadResult {
    this.prune();
    const entry = this.entries.get(handle.executionId);
    if (!entry) return { ok: false, status: 410, error: "execution_expired" };
    if (entry.owner !== owner) return { ok: false, status: 404, error: "not_found" };
    if (entry.handle.binding !== handle.binding || entry.handle.currency !== handle.currency || entry.handle.model !== handle.model || entry.handle.preview !== handle.preview || entry.handle.expiresAt !== handle.expiresAt) return { ok: false, status: 409, error: "execution_mismatch" };
    if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex >= entry.snapshot.pathCount) return { ok: false, status: 400, error: "invalid_path" };
    const detail = projectPath(entry.snapshot, entry.handle.executionId, pathIndex);
    if (!detail || Buffer.byteLength(JSON.stringify(detail)) > PATH_DETAIL_LIMITS.responseBytes) return { ok: false, status: 422, error: "detail_unavailable" };
    return { ok: true, detail };
  }
}

/** Explicit inverses for this model version only; unknown/latent states stay hidden. */
export function inversePathFactor(version: string, key: string, transform: string, unit: string, value: number): number | null {
  if (version !== "simulation_economic_state_conditional_mean_v1") return null;
  if (key === "usdkrw" && transform === "log_level" && unit === "KRW / USD") return Number.isFinite(Math.exp(value)) ? Math.exp(value) : null;
  if (key === "us_10y_yield" && transform === "level" && unit === "%") return value;
  if (key === "us_10y2y_curve" && transform === "level" && unit === "pp") return value;
  return null;
}

export function projectPath(s: PathSnapshot, executionId: string, pathIndex: number): SimulationPathDetail | null {
  const n = s.horizon + 1;
  const assets = s.assets.map(asset => ({ ...asset, values: [] as number[], returns: [] as (number | null)[] }));
  const portfolio: number[] = [];
  const draws: SimulationPathDetail["draws"] = [];
  for (let step = 0; step < n; step++) {
    const row = pathIndex * n + step;
    let nav = 0, compensation = 0;
    const historical = s.model === "bootstrap" && step > 0 ? s.history[s.drawRows[row]] : undefined;
    if (s.model === "bootstrap" && step > 0 && !historical) return null;
    for (let asset = 0; asset < assets.length; asset++) {
      const growth = s.growth[row * assets.length + asset];
      if (growth <= 0 || (step === 0 && growth !== 1)) return null;
      const term = assets[asset].weightBps / 10000 * growth;
      const next = nav + term;
      compensation += Math.abs(nav) >= Math.abs(term) ? (nav - next) + term : (term - next) + nav;
      nav = next;
      assets[asset].values.push(term * 100);
      assets[asset].returns.push(step === 0 ? null : historical ? historical.returns[asset] : growth / s.growth[(row - 1) * assets.length + asset] - 1);
    }
    const value = (nav + (s.model === "bootstrap" ? compensation : 0)) * 100;
    // Existing chart intentionally rounds to seven significant digits. No rescaling.
    if (Math.abs(Number(value.toPrecision(7)) - s.chart[row]) > 1e-9 * Math.max(1, s.chart[row])) return null;
    portfolio.push(value);
    if (historical) draws.push({ step, from: historical.from, to: historical.to, blockStart: Boolean(s.blockStarts[row]) });
  }
  const factors: SimulationPathDetail["factors"] = [];
  if (s.model === "economic") s.factors.forEach((factor, column) => {
    const values = Array.from({ length: n }, (_, step) => inversePathFactor(s.modelVersion, factor.key, factor.transform, factor.unit, s.states[(pathIndex * n + step) * s.factors.length + column]));
    if (values.every((value): value is number => value !== null && Number.isFinite(value))) factors.push({ key: factor.key, label: factor.label, unit: factor.unit, observationDate: factor.observationDate, source: factor.source, values });
  });
  let peak = portfolio[0], drawdown = 0;
  for (const value of portfolio) { peak = Math.max(peak, value); drawdown = Math.max(drawdown, 1 - value / peak); }
  return { executionId, pathIndex, model: s.model, modelVersion: s.modelVersion, currency: s.currency, seed: s.seed, horizon: s.horizon, coveragePct: s.coveragePct, portfolio, finalReturnPct: (portfolio.at(-1)! / portfolio[0] - 1) * 100, maxDrawdownPct: drawdown * 100, assets, factors, draws };
}
