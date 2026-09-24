import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { PATH_DETAIL_LIMITS, projectPath, type PathSnapshot } from "./simulation-path-detail-store.ts";
import type { SimulationPathHandle } from "./simulation-path-detail.ts";

export const EXECUTION_POLICY = Object.freeze({ codec: "path-f64le-gzip-v1", projection: 1, group: 8, ttlSeconds: 21600, creatingSeconds: 1800, maxBytes: 96 * 1024 * 1024, ownerBytes: 192 * 1024 * 1024, ownerCount: 2, commonRaw: 2 * 1024 * 1024, chunkRaw: 600 * 1024, batch: 4 });
export type Piece = { index: number; first: number; count: number; rawBytes: number; bytes: number; checksum: string; compressedHash: string; data: string };
export type Manifest = Omit<Piece, "data">;
export type PackedExecution = { id: string; binding: string; model: PathSnapshot["model"]; currency: PathSnapshot["currency"]; modelVersion: string; seed: number; pathCount: number; horizon: number; assets: number; factors: number; rawBytes: number; bytes: number; common: Piece; chunks: Piece[] };
type Common = Omit<PathSnapshot, "growth" | "chart" | "states" | "drawRows" | "blockStarts" | "history"> & { history: { from: string; to: string }[] };
export const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const manifestOf = ({ data, ...manifest }: Piece): Manifest => { void data; return manifest; };
function pack(raw: Buffer, index: number, first: number, count: number): Piece {
  const zipped = gzipSync(raw, { level: 6 });
  return { index, first, count, rawBytes: raw.length, bytes: zipped.length, checksum: digest(raw), compressedHash: digest(zipped), data: zipped.toString("base64") };
}
function unpack(piece: Piece, max: number): Buffer {
  if (!Number.isSafeInteger(piece.rawBytes) || piece.rawBytes < 1 || piece.rawBytes > max || !Number.isSafeInteger(piece.bytes) || piece.bytes < 1 || piece.bytes > max + 1024 || piece.data.length > Math.ceil((max + 1024) / 3) * 4) throw Error("corrupt");
  const zipped = Buffer.from(piece.data, "base64");
  if (zipped.length !== piece.bytes || digest(zipped) !== piece.compressedHash) throw Error("corrupt");
  const raw = gunzipSync(zipped, { maxOutputLength: piece.rawBytes });
  if (raw.length !== piece.rawBytes || digest(raw) !== piece.checksum) throw Error("corrupt");
  return raw;
}
function shape(s: Pick<PathSnapshot, "pathCount" | "horizon" | "assets" | "factors" | "model" | "currency">) {
  if (!Number.isInteger(s.pathCount) || s.pathCount < 1 || s.pathCount > 1000 || !Number.isInteger(s.horizon) || s.horizon < 1 || s.horizon > 126 || !Array.isArray(s.assets) || s.assets.length < 1 || s.assets.length > 64 || !Array.isArray(s.factors) || s.factors.length > 3 || !["economic", "bootstrap"].includes(s.model) || !["KRW", "USD"].includes(s.currency)) throw Error("shape");
  if (s.model === "bootstrap" && s.factors.length) throw Error("shape");
  if (new Set(s.assets.map(a => a.key)).size !== s.assets.length || s.assets.some(a => !a.key || a.key.length > 160 || a.label.length > 240 || !Number.isInteger(a.weightBps) || a.weightBps < 0) || s.assets.reduce((sum, a) => sum + a.weightBps, 0) !== 10000) throw Error("shape");
}
function validDraw(draw: number, block: number, step: number, history: number) {
  return (block === 0 || block === 1) && Number.isInteger(draw)
    && (step === 0 ? draw === -1 && block === 0 : draw >= 0 && draw < history);
}
export function packExecution(owner: string, s: PathSnapshot, id = randomUUID()): PackedExecution {
  shape(s);
  if (!Number.isSafeInteger(s.seed) || !Number.isFinite(s.coveragePct) || s.coveragePct < 0 || s.coveragePct > 100 || s.provenance.length > 8192 || !s.modelVersion || s.modelVersion.length > 160 || s.history.length > 2000 || s.factors.some(f => Object.values(f).some(v => v.length > 240))) throw Error("shape");
  const n = s.horizon + 1, a = s.assets.length, f = s.factors.length, rows = n * s.pathCount;
  if (s.growth.length !== rows * a || s.chart.length !== rows || s.states.length !== rows * f || (s.model === "bootstrap" ? s.drawRows.length !== rows || s.blockStarts.length !== rows || !s.history.length : s.drawRows.length || s.blockStarts.length || s.history.length)) throw Error("shape");
  for (const xs of [s.growth, s.chart, s.states]) for (const v of xs) if (!Number.isFinite(v)) throw Error("shape");
  if (s.model === "bootstrap") for (let row = 0; row < rows; row++) {
    if (!validDraw(s.drawRows[row], s.blockStarts[row], row % n, s.history.length)) throw Error("shape");
  }
  const { growth: _growth, chart: _chart, states: _states, drawRows: _draw, blockStarts: _blocks, history, ...meta } = s;
  void _growth; void _chart; void _states; void _draw; void _blocks;
  const commonJson = Buffer.from(JSON.stringify({ ...meta, history: history.map(({ from, to }) => ({ from, to })) }));
  const commonRaw = Buffer.alloc(4 + commonJson.length + history.length * a * 8);
  if (commonRaw.length > EXECUTION_POLICY.commonRaw) throw Error("shape");
  commonRaw.writeUInt32LE(commonJson.length); commonJson.copy(commonRaw, 4);
  history.forEach((r, i) => { if (r.returns.length !== a || r.from.length > 32 || r.to.length > 32) throw Error("shape"); r.returns.forEach((v, j) => { if (!Number.isFinite(v) || v <= -1) throw Error("shape"); commonRaw.writeDoubleLE(v, 4 + commonJson.length + (i * a + j) * 8); }); });
  const common = pack(commonRaw, -1, 0, s.pathCount), chunks: Piece[] = [];
  for (let first = 0; first < s.pathCount; first += EXECUTION_POLICY.group) {
    const count = Math.min(EXECUTION_POLICY.group, s.pathCount - first);
    const raw = Buffer.alloc(count * n * ((a + f + 1) * 8 + (s.model === "bootstrap" ? 5 : 0)));
    if (raw.length > EXECUTION_POLICY.chunkRaw) throw Error("shape");
    let offset = 0;
    for (let path = first; path < first + count; path++) for (let step = 0; step < n; step++) {
      const row = path * n + step;
      for (const [values, width] of [[s.growth, a], [s.chart, 1], [s.states, f]] as const) for (let col = 0; col < width; col++) { raw.writeDoubleLE(values[row * width + col], offset); offset += 8; }
      if (s.model === "bootstrap") { raw.writeInt32LE(s.drawRows[row], offset); offset += 4; raw[offset++] = s.blockStarts[row]; }
    }
    chunks.push(pack(raw, chunks.length, first, count));
  }
  const rawBytes = common.rawBytes + chunks.reduce((sum, c) => sum + c.rawBytes, 0);
  const bytes = common.bytes + chunks.reduce((sum, c) => sum + c.bytes, 0);
  if (bytes > EXECUTION_POLICY.maxBytes) throw Error("size");
  const binding = digest(JSON.stringify({ owner, codec: EXECUTION_POLICY.codec, projection: EXECUTION_POLICY.projection, common: manifestOf(common), chunks: chunks.map(manifestOf) }));
  return { id, binding, model: s.model, modelVersion: s.modelVersion, currency: s.currency, seed: s.seed, pathCount: s.pathCount, horizon: s.horizon, assets: a, factors: f, rawBytes, bytes, common, chunks };
}
export function decodePath(handle: SimulationPathHandle, pathIndex: number, commonPiece: Piece, chunk: Piece) {
  const commonRaw = unpack(commonPiece, EXECUTION_POLICY.commonRaw);
  const jsonLength = commonRaw.readUInt32LE(0);
  if (jsonLength > commonRaw.length - 4) throw Error("corrupt");
  const c = JSON.parse(commonRaw.subarray(4, 4 + jsonLength).toString()) as Common;
  shape(c);
  if (c.model !== handle.model || c.currency !== handle.currency || !Array.isArray(c.history) || c.history.length > 2000 || chunk.first !== chunk.index * EXECUTION_POLICY.group || chunk.count !== Math.min(EXECUTION_POLICY.group, c.pathCount - chunk.first) || pathIndex < chunk.first || pathIndex >= chunk.first + chunk.count) throw Error("corrupt");
  const n = c.horizon + 1, a = c.assets.length, f = c.factors.length;
  if (commonRaw.length !== 4 + jsonLength + c.history.length * a * 8) throw Error("corrupt");
  const raw = unpack(chunk, EXECUTION_POLICY.chunkRaw), stride = n * ((a + f + 1) * 8 + (c.model === "bootstrap" ? 5 : 0));
  if (raw.length !== chunk.count * stride) throw Error("corrupt");
  const history = c.history.map((row, i) => ({ ...row, returns: Array.from({ length: a }, (_, j) => commonRaw.readDoubleLE(4 + jsonLength + (i * a + j) * 8)) }));
  if ((c.model === "bootstrap" ? !history.length : history.length > 0)
    || history.some(row => typeof row.from !== "string" || typeof row.to !== "string" || row.from.length > 32 || row.to.length > 32 || row.returns.some(v => !Number.isFinite(v) || v <= -1))) throw Error("corrupt");
  const s: PathSnapshot = { ...c, pathCount: 1, history, growth: new Float64Array(n * a), chart: new Float64Array(n), states: new Float64Array(n * f), drawRows: new Int32Array(c.model === "bootstrap" ? n : 0), blockStarts: new Uint8Array(c.model === "bootstrap" ? n : 0) };
  let offset = (pathIndex - chunk.first) * stride;
  for (let step = 0; step < n; step++) {
    for (const [values, width] of [[s.growth, a], [s.chart, 1], [s.states, f]] as const) for (let col = 0; col < width; col++) { const value = raw.readDoubleLE(offset); if (!Number.isFinite(value)) throw Error("corrupt"); values[step * width + col] = value; offset += 8; }
    if (c.model === "bootstrap") { s.drawRows[step] = raw.readInt32LE(offset); offset += 4; s.blockStarts[step] = raw[offset++]; if (!validDraw(s.drawRows[step], s.blockStarts[step], step, history.length)) throw Error("corrupt"); }
  }
  const detail = projectPath(s, handle.executionId, 0);
  if (!detail) throw Error("corrupt");
  detail.pathIndex = pathIndex;
  if (Buffer.byteLength(JSON.stringify(detail)) > PATH_DETAIL_LIMITS.responseBytes) throw Error("response_size");
  return detail;
}
