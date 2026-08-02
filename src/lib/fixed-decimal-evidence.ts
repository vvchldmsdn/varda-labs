const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_TWO = BigInt(2);
const BIGINT_HUNDRED = BigInt(100);
const DECIMAL_SCALE = BigInt(1_000_000);

export function isSignedFixedDecimal(value: string) {
  return /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value);
}

export function isNonnegativeFixedDecimal(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value);
}

export function sumNullableFixedDecimals(
  values: readonly (string | null)[],
) {
  if (values.some((value) => value === null)) return null;
  let total = BIGINT_ZERO;
  for (const value of values) {
    const parsed = parseFixed(value!);
    if (parsed === null) return null;
    total += parsed;
  }
  return formatFixed(total);
}

export function sumNullableSafeIntegers(
  values: readonly (number | null)[],
) {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return Number.isSafeInteger(total) ? total : null;
}

export function fixedPercent(
  numeratorValue: string | null,
  denominatorValue: string | null,
) {
  if (numeratorValue === null || denominatorValue === null) return null;
  const numerator = parseFixed(numeratorValue);
  const denominator = parseFixed(denominatorValue);
  if (
    numerator === null ||
    denominator === null ||
    denominator <= BIGINT_ZERO
  ) {
    return null;
  }

  const scaledNumerator = numerator * BIGINT_HUNDRED * DECIMAL_SCALE;
  let quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  if (absolute(remainder) * BIGINT_TWO >= absolute(denominator)) {
    quotient +=
      scaledNumerator < BIGINT_ZERO ? -BIGINT_ONE : BIGINT_ONE;
  }
  return formatFixed(quotient);
}

function parseFixed(value: string) {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(6, "0");
  const magnitude = BigInt(match[2]) * DECIMAL_SCALE + BigInt(fraction || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function formatFixed(value: bigint) {
  const sign = value < BIGINT_ZERO ? "-" : "";
  const magnitude = value < BIGINT_ZERO ? -value : value;
  const integer = magnitude / DECIMAL_SCALE;
  const fraction = String(magnitude % DECIMAL_SCALE).padStart(6, "0");
  return `${sign}${integer}.${fraction}`;
}

function absolute(value: bigint) {
  return value < BIGINT_ZERO ? -value : value;
}
