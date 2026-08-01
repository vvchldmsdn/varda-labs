export type IdentityPairingClaimPresentationAudit = Readonly<{
  outcome: "consumed" | "not_consumed" | "unavailable";
  phase:
    | "complete"
    | "claim_validation"
    | "runtime_composition"
    | "verified_session"
    | "session_capability"
    | "identity_consume"
    | "runtime_result"
    | "transport"
    | "configuration"
    | "runtime";
  category:
    | "consumed"
    | "claim_invalid"
    | "database_port_invalid"
    | "composition_invalid"
    | "verified_session_unavailable"
    | "session_capability_invalid"
    | "identity_consume_failed"
    | "result_invalid"
    | "transport_rejected"
    | "runtime_misconfigured"
    | "runtime_unavailable";
}>;

export const IDENTITY_PAIRING_CLAIM_PRESENTATION_STATIC_AUDITS =
  Object.freeze({
    transportRejected: audit(
      "not_consumed",
      "transport",
      "transport_rejected",
    ),
    runtimeMisconfigured: audit(
      "unavailable",
      "configuration",
      "runtime_misconfigured",
    ),
    runtimeUnavailable: audit(
      "unavailable",
      "runtime",
      "runtime_unavailable",
    ),
  });

export function projectIdentityPairingClaimPresentationAudit(
  value: unknown,
): IdentityPairingClaimPresentationAudit {
  const result = readOwnDataValue(value, "result");
  const committed = readOwnDataValue(value, "committed");
  const writerInvoked = readOwnDataValue(value, "writerInvoked");

  if (
    result === "consumed" &&
    committed === true &&
    writerInvoked === true
  ) {
    return audit("consumed", "complete", "consumed");
  }

  const blocker = readOwnDataValue(value, "blocker");
  if (
    result === "blocked" &&
    committed === false &&
    writerInvoked === false
  ) {
    switch (blocker) {
      case "claim_invalid":
        return audit(
          "not_consumed",
          "claim_validation",
          "claim_invalid",
        );
      case "database_port_invalid":
        return audit(
          "not_consumed",
          "runtime_composition",
          "database_port_invalid",
        );
      case "composition_invalid":
        return audit(
          "not_consumed",
          "runtime_composition",
          "composition_invalid",
        );
      case "verified_session_unavailable":
        return audit(
          "not_consumed",
          "verified_session",
          "verified_session_unavailable",
        );
      case "session_capability_invalid":
        return audit(
          "not_consumed",
          "session_capability",
          "session_capability_invalid",
        );
    }
  }

  if (
    result === "failed" &&
    blocker === "identity_consume_failed" &&
    committed === false &&
    typeof writerInvoked === "boolean"
  ) {
    return audit(
      "not_consumed",
      writerInvoked ? "identity_consume" : "session_capability",
      "identity_consume_failed",
    );
  }

  return audit("not_consumed", "runtime_result", "result_invalid");
}

function audit(
  outcome: IdentityPairingClaimPresentationAudit["outcome"],
  phase: IdentityPairingClaimPresentationAudit["phase"],
  category: IdentityPairingClaimPresentationAudit["category"],
): IdentityPairingClaimPresentationAudit {
  return Object.freeze(
    Object.assign(Object.create(null), { outcome, phase, category }),
  );
}

function readOwnDataValue(value: unknown, key: string) {
  if (value === null || typeof value !== "object") return undefined;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor
    ? descriptor.value
    : undefined;
}
