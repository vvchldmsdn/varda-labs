import { createHash } from "node:crypto";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function fingerprintAppUserId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new TypeError("App-user identifier must be a canonical UUID");
  }
  return sha256("app-user-id-v1", value.trim().toLowerCase());
}

export function fingerprintLegacyOwner(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0
  ) {
    throw new TypeError("Legacy owner evidence must be non-empty text");
  }
  return sha256("legacy-owner-evidence-v1", value);
}

export function isSha256Fingerprint(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function normalizeAppUsers(appUsers) {
  if (!Array.isArray(appUsers)) throw new TypeError("appUsers must be an array");

  return appUsers.map((appUser) => {
    if (
      appUser === null ||
      typeof appUser !== "object" ||
      typeof appUser.id !== "string" ||
      !UUID_PATTERN.test(appUser.id.trim()) ||
      typeof appUser.status !== "string" ||
      typeof appUser.role !== "string"
    ) {
      throw new TypeError("App-user evidence is malformed");
    }

    return {
      id: appUser.id.trim().toLowerCase(),
      status: appUser.status,
      role: appUser.role,
    };
  });
}

export function normalizeAccounts(accounts) {
  if (!Array.isArray(accounts)) throw new TypeError("accounts must be an array");

  return accounts.map((account) => {
    if (
      account === null ||
      typeof account !== "object" ||
      typeof account.id !== "string" ||
      !UUID_PATTERN.test(account.id.trim())
    ) {
      throw new TypeError("Account evidence is malformed");
    }

    return {
      id: account.id.trim().toLowerCase(),
      legacyOwnerUserId: normalizeOptionalEvidence(
        account.legacyOwnerUserId,
      ),
      canonicalOwnerUserId: normalizeOptionalUuid(
        account.canonicalOwnerUserId,
      ),
    };
  });
}

export function digestDiscoveryEvidence(appUsers, accounts) {
  return sha256(
    "legacy-account-discovery-v1",
    stableStringify({
      appUsers: [...appUsers].sort(compareId),
      accounts: [...accounts].sort(compareId),
    }),
  );
}

export function digestCandidateSet(
  targetAppUserSha256,
  legacyOwnerSha256,
  classifiedRows,
) {
  return sha256(
    "legacy-account-candidate-set-v1",
    stableStringify({
      targetAppUserSha256,
      legacyOwnerSha256,
      rows: [...classifiedRows].sort((left, right) =>
        compareAscii(left.accountId, right.accountId),
      ),
    }),
  );
}

export function digestEligibleSet(classifiedRows) {
  return sha256(
    "legacy-account-eligible-set-v1",
    stableStringify(
      classifiedRows
        .filter(({ classification }) => classification === "eligible")
        .map(({ accountId }) => accountId)
        .sort(compareAscii),
    ),
  );
}

export function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeOptionalEvidence(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new TypeError("Legacy owner evidence is malformed");
  }
  if (value.trim().length === 0) return null;
  return value;
}

function normalizeOptionalUuid(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new TypeError("Canonical owner evidence is malformed");
  }
  return value.trim().toLowerCase();
}

function sha256(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${value}`)
    .digest("hex")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareAscii)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareId(left, right) {
  return compareAscii(left.id, right.id);
}
