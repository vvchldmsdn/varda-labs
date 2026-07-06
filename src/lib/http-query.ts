const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseBooleanQuery(
  value: string | null,
  defaultValue: boolean,
) {
  if (value === null) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

export function parseDateKeyQuery(
  value: string | null,
  options: { emptyAsUndefined?: boolean } = {},
) {
  if (value === null || (options.emptyAsUndefined && value.trim() === "")) {
    return undefined;
  }

  const normalized = value.trim();
  return DATE_KEY_PATTERN.test(normalized) ? normalized : null;
}

export function parseEnumQuery<const Value extends string>(
  value: string | null,
  allowedValues: readonly Value[],
  defaultValue: Value,
): Value | null;
export function parseEnumQuery<const Value extends string>(
  value: string | null,
  allowedValues: readonly Value[],
  defaultValue: undefined,
): Value | undefined | null;
export function parseEnumQuery<const Value extends string>(
  value: string | null,
  allowedValues: readonly Value[],
  defaultValue: Value | undefined,
) {
  if (value === null || value.trim() === "") return defaultValue;

  const normalized = value.trim().toLowerCase();
  return allowedValues.includes(normalized as Value)
    ? (normalized as Value)
    : null;
}

export function parseIntegerQuery(
  value: string | null,
  options: { min: number; max: number },
) {
  if (value === null || value.trim() === "") return undefined;

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < options.min ||
    parsed > options.max
  ) {
    return null;
  }

  return parsed;
}
