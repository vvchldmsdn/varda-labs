export const CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER =
  "curated_vector_schema_rehearsal_rollback";

const EXPECTED_ROLLBACK = Object.freeze({
  outcome: "expected_rollback",
  reason: "exact_driver_marker",
});
const UNEXPECTED_DATABASE_ERROR = Object.freeze({
  outcome: "unexpected_failure",
  reason: "database_error",
});
const TRANSPORT_ERROR = Object.freeze({
  outcome: "unexpected_failure",
  reason: "transport_error",
});
const OPAQUE_ERROR = Object.freeze({
  outcome: "unexpected_failure",
  reason: "opaque_error",
});
const UNKNOWN_ENVELOPE = Object.freeze({
  outcome: "unexpected_failure",
  reason: "unknown_error_envelope",
});

const KNOWN_NEON_ERROR_KEYS = new Set([
  "name",
  "message",
  "stack",
  "severity",
  "code",
  "detail",
  "hint",
  "position",
  "internalPosition",
  "internalQuery",
  "where",
  "schema",
  "table",
  "column",
  "dataType",
  "constraint",
  "file",
  "line",
  "routine",
  "sourceError",
]);

export function classifyCuratedVectorRehearsalError(error, NeonDbErrorClass) {
  if (
    typeof NeonDbErrorClass !== "function" ||
    !(error instanceof NeonDbErrorClass) ||
    Object.getPrototypeOf(error) !== NeonDbErrorClass.prototype
  ) {
    return OPAQUE_ERROR;
  }

  for (const key of Reflect.ownKeys(error)) {
    if (typeof key !== "string" || !KNOWN_NEON_ERROR_KEYS.has(key)) {
      return UNKNOWN_ENVELOPE;
    }

    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (!descriptor) return UNKNOWN_ENVELOPE;
    if (key === "stack" && "get" in descriptor) continue;
    if (!("value" in descriptor)) return UNKNOWN_ENVELOPE;
  }

  if (error.sourceError !== undefined) return TRANSPORT_ERROR;

  return error.message === CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER
    ? EXPECTED_ROLLBACK
    : UNEXPECTED_DATABASE_ERROR;
}
