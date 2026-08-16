export const HOLDING_STATE_CORRECTION_POLICY = Object.freeze({
  version: "holding_state_correction_v1",
  semantics: "current_state_correction_not_trade",
  correctedFields: Object.freeze(["quantity", "averageCost"] as const),
  reasonMaximumLength: 500,
} as const);

export type HoldingStateCorrectionActionState = Readonly<{
  status:
    | "idle"
    | "success"
    | "invalid"
    | "unauthorized"
    | "conflict"
    | "error";
  message: string | null;
}>;

export type HoldingStateCorrectionInput = Readonly<{
  assetId: string;
  expectedUpdatedAt: string;
  quantity: string;
  averageCost: string;
  reason: string | null;
}>;

export type HoldingStateCorrectionParseResult =
  | Readonly<{ ok: true; input: HoldingStateCorrectionInput }>
  | Readonly<{ ok: false; message: string }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRICT_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function parseHoldingStateCorrectionInput(
  formData: FormData,
): HoldingStateCorrectionParseResult {
  const assetId = textValue(formData.get("assetId"));
  if (assetId === null || !UUID_PATTERN.test(assetId)) {
    return invalid("보유종목 식별자가 올바르지 않습니다.");
  }

  const expectedUpdatedAt = textValue(formData.get("expectedUpdatedAt"));
  const parsedUpdatedAt = new Date(expectedUpdatedAt ?? "");
  if (
    expectedUpdatedAt === null ||
    !STRICT_UTC_TIMESTAMP_PATTERN.test(expectedUpdatedAt) ||
    !Number.isFinite(parsedUpdatedAt.getTime()) ||
    parsedUpdatedAt.toISOString() !== expectedUpdatedAt
  ) {
    return invalid("화면을 새로고침한 뒤 다시 정정해 주세요.");
  }

  const quantity = positiveDecimal(formData.get("quantity"), 20, 6);
  if (quantity === null) {
    return invalid("보유 수량은 0보다 큰 숫자로 소수점 6자리까지 입력해 주세요.");
  }

  const averageCost = positiveDecimal(formData.get("averageCost"), 20, 4);
  if (averageCost === null) {
    return invalid(
      "1좌당 평균 매입가는 0보다 큰 숫자로 소수점 4자리까지 입력해 주세요.",
    );
  }

  const reason = normalizeReason(formData.get("reason"));
  if (reason === undefined) {
    return invalid("정정 사유는 제어문자 없이 500자 이내로 입력해 주세요.");
  }

  return Object.freeze({
    ok: true,
    input: Object.freeze({
      assetId,
      expectedUpdatedAt,
      quantity,
      averageCost,
      reason,
    }),
  });
}

function positiveDecimal(
  value: FormDataEntryValue | null,
  precision: number,
  scale: number,
) {
  const normalized = textValue(value);
  if (normalized === null || !DECIMAL_PATTERN.test(normalized)) return null;

  const [integerPart, fractionalPart = ""] = normalized.split(".");
  const significantIntegerLength = integerPart.replace(/^0+/, "").length;
  if (
    fractionalPart.length > scale ||
    significantIntegerLength > precision - scale ||
    !/[1-9]/.test(`${integerPart}${fractionalPart}`)
  ) {
    return null;
  }
  return normalized;
}

function normalizeReason(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (
    normalized.length > HOLDING_STATE_CORRECTION_POLICY.reasonMaximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function textValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function invalid(message: string): HoldingStateCorrectionParseResult {
  return Object.freeze({ ok: false, message });
}
