export const MULBERRY32_POLICY = Object.freeze({
  version: "mulberry32_v1",
  seedType: "uint32",
  outputRange: "zero_inclusive_one_exclusive",
} as const);

export function createMulberry32(seed: number) {
  let state = seed >>> 0;

  return function nextMulberry32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function isUint32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffff_ffff
  );
}
