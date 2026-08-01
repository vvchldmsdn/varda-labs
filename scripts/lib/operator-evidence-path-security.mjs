import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const WINDOWS_SID_PATTERN = /^S-\d(?:-\d+)+$/;
const WINDOWS_SYSTEM_SID = "S-1-5-18";
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
const WINDOWS_EVIDENCE_PATH_ENV =
  "VARDA_IDENTITY_BOOTSTRAP_EVIDENCE_ACL_PATH";

export function attestOwnerScopedPathAccess(path, pathType) {
  const security = readPlatformPathSecurity(path, pathType);
  assertOwnerScopedPathSecurity(security, pathType);
}

export function assertOwnerScopedPathSecurity(security, pathType) {
  if (!["directory", "file"].includes(pathType)) {
    throw new Error("operator evidence path security invalid");
  }
  const platform = readOwnDataValue(security, "platform");
  const currentUserId = readOwnDataValue(
    security,
    "currentUserId",
  );
  const ownerId = readOwnDataValue(security, "ownerId");
  if (
    typeof currentUserId !== "string" ||
    currentUserId.length === 0 ||
    ownerId !== currentUserId
  ) {
    throw new Error("operator evidence path security invalid");
  }

  if (platform === "win32") {
    assertWindowsPathSecurity({
      security,
      pathType,
      currentUserId,
    });
    return;
  }
  if (platform === "posix") {
    const mode = readOwnDataValue(security, "mode");
    const requiredMode = pathType === "directory" ? 0o700 : 0o600;
    if (mode !== requiredMode) {
      throw new Error("operator evidence path security invalid");
    }
    return;
  }
  throw new Error("operator evidence path security invalid");
}

function assertWindowsPathSecurity({
  security,
  pathType,
  currentUserId,
}) {
  if (
    !WINDOWS_SID_PATTERN.test(currentUserId) ||
    (pathType === "directory" &&
      readOwnDataValue(security, "accessRulesProtected") !== true)
  ) {
    throw new Error("operator evidence path security invalid");
  }
  const allowPrincipalIds = readOwnDataValue(
    security,
    "allowPrincipalIds",
  );
  if (!Array.isArray(allowPrincipalIds)) {
    throw new Error("operator evidence path security invalid");
  }
  const allowed = new Set([
    currentUserId,
    WINDOWS_SYSTEM_SID,
    WINDOWS_ADMINISTRATORS_SID,
  ]);
  if (
    !allowPrincipalIds.includes(currentUserId) ||
    allowPrincipalIds.some(
      (principalId) =>
        typeof principalId !== "string" ||
        !WINDOWS_SID_PATTERN.test(principalId) ||
        !allowed.has(principalId),
    )
  ) {
    throw new Error("operator evidence path security invalid");
  }
}

function readPlatformPathSecurity(path, pathType) {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    (pathType === "directory" && !stat.isDirectory()) ||
    (pathType === "file" && !stat.isFile())
  ) {
    throw new Error("operator evidence path type invalid");
  }
  if (process.platform === "win32") {
    return readWindowsPathSecurity(path);
  }
  if (typeof process.getuid !== "function") {
    throw new Error("operator evidence ownership API unavailable");
  }
  return createNullRecord({
    platform: "posix",
    currentUserId: String(process.getuid()),
    ownerId: String(stat.uid),
    mode: stat.mode & 0o777,
  });
}

function readWindowsPathSecurity(path) {
  const systemRoot = readOwnDataValue(process.env, "SystemRoot");
  if (typeof systemRoot !== "string" || !isAbsolute(systemRoot)) {
    throw new Error("Windows system root unavailable");
  }
  const executable = realpathSync(
    join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
  );
  const encodedCommand = Buffer.from(
    createWindowsAclInspectionScript(),
    "utf16le",
  ).toString("base64");
  const result = spawnSync(
    executable,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedCommand,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        [WINDOWS_EVIDENCE_PATH_ENV]: path,
      },
      maxBuffer: 64 * 1024,
      timeout: 5_000,
      windowsHide: true,
    },
  );
  if (
    result.status !== 0 ||
    result.error !== undefined ||
    typeof result.stdout !== "string" ||
    result.stdout.trim().length === 0
  ) {
    throw new Error("Windows ACL inspection failed");
  }
  const parsed = JSON.parse(result.stdout.trim());
  const allowPrincipalIds = readOwnDataValue(
    parsed,
    "allowPrincipalIds",
  );
  return createNullRecord({
    platform: "win32",
    currentUserId: readOwnDataValue(parsed, "currentUserId"),
    ownerId: readOwnDataValue(parsed, "ownerId"),
    accessRulesProtected: readOwnDataValue(
      parsed,
      "accessRulesProtected",
    ),
    allowPrincipalIds: Array.isArray(allowPrincipalIds)
      ? Object.freeze([...allowPrincipalIds])
      : allowPrincipalIds,
  });
}

function createWindowsAclInspectionScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$path = [Environment]::GetEnvironmentVariable('${WINDOWS_EVIDENCE_PATH_ENV}')`,
    "if ([string]::IsNullOrWhiteSpace($path)) { throw 'missing path' }",
    "$acl = Get-Acl -LiteralPath $path",
    "$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$owner = ([System.Security.Principal.NTAccount]$acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value",
    "$allowSids = @($acl.Access | Where-Object { $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow } | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })",
    "[pscustomobject]@{ currentUserId = $current; ownerId = $owner; accessRulesProtected = [bool]$acl.AreAccessRulesProtected; allowPrincipalIds = [object[]]$allowSids } | ConvertTo-Json -Depth 4 -Compress",
  ].join("; ");
}

function createNullRecord(value) {
  return Object.freeze(
    Object.assign(Object.create(null), value),
  );
}

function readOwnDataValue(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor
    ? descriptor.value
    : undefined;
}
