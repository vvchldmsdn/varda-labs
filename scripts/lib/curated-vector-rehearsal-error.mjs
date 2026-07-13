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

export function classifyCuratedVectorRehearsalError(error) {
  if (!(error instanceof Error) || error.name !== "NeonDbError") {
    return OPAQUE_ERROR;
  }

  if (Object.keys(error).some((key) => !KNOWN_NEON_ERROR_KEYS.has(key))) {
    return UNKNOWN_ENVELOPE;
  }

  if (error.sourceError !== undefined) return TRANSPORT_ERROR;

  return error.message === CURATED_VECTOR_REHEARSAL_ROLLBACK_MARKER
    ? EXPECTED_ROLLBACK
    : UNEXPECTED_DATABASE_ERROR;
}
