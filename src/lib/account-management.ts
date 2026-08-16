export const ACCOUNT_MANAGEMENT_POLICY = Object.freeze({
  version: "owner_scoped_account_management_v1",
  maximumActiveAccounts: 64,
  generatedAccountType: "investment",
  generatedReportingCurrency: "KRW",
  accountCodePrefix: "acct_",
  archiveSemantics: "soft_archive_after_current_reference_checks",
} as const);

export type AccountManagementActionState = Readonly<{
  status:
    | "idle"
    | "success"
    | "invalid"
    | "unauthorized"
    | "conflict"
    | "error";
  message: string | null;
}>;

export type AccountCreateInput = Readonly<{
  name: string;
}>;

export type AccountUpdateInput = Readonly<{
  accountId: string;
  expectedUpdatedAt: string;
  name: string;
}>;

export type AccountLifecycleInput = Readonly<{
  accountId: string;
  expectedUpdatedAt: string;
}>;

type ParseResult<T> =
  | Readonly<{ ok: true; input: T }>
  | Readonly<{ ok: false; message: string }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRICT_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function parseAccountCreateInput(
  formData: FormData,
): ParseResult<AccountCreateInput> {
  const name = normalizeName(formData.get("name"));
  if (name === null) {
    return invalid("Enter an account name between 1 and 100 characters.");
  }
  return Object.freeze({ ok: true, input: Object.freeze({ name }) });
}

export function parseAccountUpdateInput(
  formData: FormData,
): ParseResult<AccountUpdateInput> {
  const identity = parseIdentity(formData);
  if (!identity.ok) return identity;

  const name = normalizeName(formData.get("name"));
  if (name === null) {
    return invalid("Enter an account name between 1 and 100 characters.");
  }
  return Object.freeze({
    ok: true,
    input: Object.freeze({ ...identity.input, name }),
  });
}

export function parseAccountArchiveInput(
  formData: FormData,
): ParseResult<AccountLifecycleInput> {
  const identity = parseIdentity(formData);
  if (!identity.ok) return identity;
  if (formData.get("archiveConfirmed") !== "yes") {
    return invalid("Confirm that this account should be archived.");
  }
  return identity;
}

export function parseAccountRestoreInput(
  formData: FormData,
): ParseResult<AccountLifecycleInput> {
  return parseIdentity(formData);
}

export function generatedAccountCode(accountId: string) {
  if (!UUID_PATTERN.test(accountId)) {
    throw new Error("A canonical account UUID is required.");
  }
  return `${ACCOUNT_MANAGEMENT_POLICY.accountCodePrefix}${accountId.replaceAll("-", "")}`;
}

function parseIdentity(
  formData: FormData,
): ParseResult<AccountLifecycleInput> {
  const accountId = optionalText(formData.get("accountId"));
  const expectedUpdatedAt = optionalText(formData.get("expectedUpdatedAt"));
  if (accountId === null || !UUID_PATTERN.test(accountId)) {
    return invalid("The account identity is invalid.");
  }
  const parsedTimestamp = new Date(expectedUpdatedAt ?? "");
  if (
    expectedUpdatedAt === null ||
    !STRICT_UTC_TIMESTAMP_PATTERN.test(expectedUpdatedAt) ||
    !Number.isFinite(parsedTimestamp.getTime()) ||
    parsedTimestamp.toISOString() !== expectedUpdatedAt
  ) {
    return invalid("Refresh the page before changing this account.");
  }
  return Object.freeze({
    ok: true,
    input: Object.freeze({ accountId, expectedUpdatedAt }),
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

function optionalText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function invalid<T>(message: string): ParseResult<T> {
  return Object.freeze({ ok: false, message });
}
