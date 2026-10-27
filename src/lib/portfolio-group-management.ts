export const PORTFOLIO_GROUP_MANAGEMENT_POLICY = Object.freeze({
  version: "portfolio_group_management_v1",
  maximumAccountMemberships: 64,
  maximumDirectAssetMemberships: 256,
  removalSemantics: "archive_group_and_close_membership_periods",
  redundantMembershipSemantics:
    "whole_account_membership_supersedes_direct_asset_membership",
} as const);

export type PortfolioGroupManagementActionState = Readonly<{
  status:
    | "idle"
    | "success"
    | "invalid"
    | "unauthorized"
    | "conflict"
    | "error";
  message: string | null;
}>;

export type PortfolioGroupSaveInput = Readonly<{
  mode: "create" | "update";
  groupId: string | null;
  expectedUpdatedAt: string | null;
  name: string;
  description: string | null;
  accountIds: readonly string[];
  assetIds: readonly string[];
}>;

export type PortfolioGroupArchiveInput = Readonly<{
  groupId: string;
  expectedUpdatedAt: string;
}>;

type ParseResult<T> =
  | Readonly<{ ok: true; input: T }>
  | Readonly<{ ok: false; message: string }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRICT_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function parsePortfolioGroupSaveInput(
  formData: FormData,
): ParseResult<PortfolioGroupSaveInput> {
  const rawGroupId = optionalText(formData.get("groupId"));
  const mode = rawGroupId === null ? "create" : "update";
  if (rawGroupId !== null && !UUID_PATTERN.test(rawGroupId)) {
    return invalid("분석 범위 식별자가 올바르지 않습니다.");
  }

  const expectedUpdatedAt = optionalText(formData.get("expectedUpdatedAt"));
  if (
    mode === "update" &&
    (expectedUpdatedAt === null || !isStrictUtcTimestamp(expectedUpdatedAt))
  ) {
    return invalid("분석 범위의 최신 상태를 확인할 수 없습니다.");
  }
  if (mode === "create" && expectedUpdatedAt !== null) {
    return invalid("새 분석 범위에 기존 버전 값이 포함되어 있습니다.");
  }

  const name = normalizeName(formData.get("name"));
  if (name === null) {
    return invalid("분석 범위 이름을 100자 이내로 입력해 주세요.");
  }

  const description = normalizeDescription(formData.get("description"));
  if (description === undefined) {
    return invalid("설명은 500자 이내로 입력해 주세요.");
  }

  const accountIds = normalizeUuidList(
    formData.getAll("accountId"),
    PORTFOLIO_GROUP_MANAGEMENT_POLICY.maximumAccountMemberships,
  );
  if (accountIds === null) {
    return invalid("선택한 계좌 목록이 올바르지 않습니다.");
  }

  const assetIds = normalizeUuidList(
    formData.getAll("assetId"),
    PORTFOLIO_GROUP_MANAGEMENT_POLICY.maximumDirectAssetMemberships,
  );
  if (assetIds === null) {
    return invalid("선택한 종목 목록이 올바르지 않습니다.");
  }

  return Object.freeze({
    ok: true,
    input: Object.freeze({
      mode,
      groupId: rawGroupId,
      expectedUpdatedAt,
      name,
      description,
      accountIds,
      assetIds,
    }),
  });
}

export function parsePortfolioGroupArchiveInput(
  formData: FormData,
): ParseResult<PortfolioGroupArchiveInput> {
  const groupId = optionalText(formData.get("groupId"));
  const expectedUpdatedAt = optionalText(formData.get("expectedUpdatedAt"));
  if (groupId === null || !UUID_PATTERN.test(groupId)) {
    return invalid("분석 범위 식별자가 올바르지 않습니다.");
  }
  if (
    expectedUpdatedAt === null ||
    !isStrictUtcTimestamp(expectedUpdatedAt)
  ) {
    return invalid("분석 범위의 최신 상태를 확인할 수 없습니다.");
  }
  if (formData.get("archiveConfirmed") !== "yes") {
    return invalid("분석 범위 삭제 확인란을 선택해 주세요.");
  }

  return Object.freeze({
    ok: true,
    input: Object.freeze({ groupId, expectedUpdatedAt }),
  });
}

function normalizeName(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length === 0 ||
    normalized.length > 100 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizeDescription(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return value === null ? null : undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > 500 || normalized.includes("\u0000")) {
    return undefined;
  }
  return normalized;
}

function normalizeUuidList(
  values: readonly FormDataEntryValue[],
  maximumCount: number,
) {
  if (values.some((value) => typeof value !== "string")) return null;
  const normalized = [
    ...new Set(values.map((value) => String(value).trim().toLowerCase())),
  ].sort();
  if (
    normalized.length > maximumCount ||
    normalized.some((value) => !UUID_PATTERN.test(value))
  ) {
    return null;
  }
  return Object.freeze(normalized);
}

function optionalText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isStrictUtcTimestamp(value: string) {
  if (!STRICT_UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function invalid<T>(message: string): ParseResult<T> {
  return Object.freeze({ ok: false, message });
}
