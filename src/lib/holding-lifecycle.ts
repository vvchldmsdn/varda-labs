export const HOLDING_LIFECYCLE_POLICY = Object.freeze({
  version: "holding_lifecycle_v1",
  semantics: "soft_archive_preserve_financial_evidence",
  reasonMaximumLength: 500,
} as const);

export type HoldingLifecycleActionState = Readonly<{
  status:
    | "idle"
    | "success"
    | "invalid"
    | "unauthorized"
    | "conflict"
    | "error";
  message: string | null;
}>;

export type HoldingLifecycleInput = Readonly<{
  assetId: string;
  expectedUpdatedAt: string;
  reason: string | null;
}>;

export type HoldingLifecycleParseResult =
  | Readonly<{ ok: true; input: HoldingLifecycleInput }>
  | Readonly<{ ok: false; message: string }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRICT_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function parseHoldingArchiveInput(
  formData: FormData,
): HoldingLifecycleParseResult {
  if (formData.get("archiveConfirmed") !== "yes") {
    return invalid("종료 확인 항목을 선택해 주세요.");
  }
  return parseSharedInput(formData);
}

export function parseHoldingRestoreInput(
  formData: FormData,
): HoldingLifecycleParseResult {
  return parseSharedInput(formData);
}

function parseSharedInput(formData: FormData): HoldingLifecycleParseResult {
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
    return invalid("화면을 새로고침한 뒤 다시 시도해 주세요.");
  }

  const reason = normalizeReason(formData.get("reason"));
  if (reason === undefined) {
    return invalid("메모는 제어문자 없이 500자 이내로 입력해 주세요.");
  }

  return Object.freeze({
    ok: true,
    input: Object.freeze({ assetId, expectedUpdatedAt, reason }),
  });
}

function normalizeReason(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  if (
    normalized.length > HOLDING_LIFECYCLE_POLICY.reasonMaximumLength ||
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

function invalid(message: string): HoldingLifecycleParseResult {
  return Object.freeze({ ok: false, message });
}
