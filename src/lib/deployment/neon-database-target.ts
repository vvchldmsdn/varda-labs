import { createHash } from "node:crypto";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const NEON_ENDPOINT_PATTERN = /^ep-[a-z0-9-]+$/;

export type ParsedNeonDatabaseUrl = {
  endpointId: string;
  pooled: boolean;
  username: string;
  password: string;
  databaseName: string;
};

export function parseNeonDatabaseUrl(
  rawUrl: string,
  label: string,
): ParsedNeonDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} URL is not a valid URL.`);
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${label} URL must use PostgreSQL.`);
  }
  if (!parsed.hostname.endsWith(".neon.tech")) {
    throw new Error(`${label} URL is not a Neon endpoint.`);
  }

  const hostLabel = parsed.hostname.split(".")[0];
  const pooled = hostLabel.endsWith("-pooler");
  const endpointId = hostLabel.replace(/-pooler$/, "");
  if (!NEON_ENDPOINT_PATTERN.test(endpointId)) {
    throw new Error(`${label} URL has an invalid Neon endpoint.`);
  }

  const databaseName = decodeURIComponent(
    parsed.pathname.replace(/^\/+/, ""),
  );
  if (!parsed.username || !parsed.password || !databaseName) {
    throw new Error(`${label} URL is missing connection identity.`);
  }

  return {
    endpointId,
    pooled,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    databaseName,
  };
}

export function assertOneNeonDatabaseTarget(
  pooled: ParsedNeonDatabaseUrl,
  unpooled: ParsedNeonDatabaseUrl,
  label: string,
) {
  if (
    pooled.endpointId !== unpooled.endpointId ||
    pooled.username !== unpooled.username ||
    pooled.password !== unpooled.password ||
    pooled.databaseName !== unpooled.databaseName
  ) {
    throw new Error(
      `${label} pooled and unpooled URLs do not identify one database target.`,
    );
  }
}

export function assertCanonicalSha256Fingerprint(
  value: string,
  label: string,
) {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 fingerprint.`);
  }
}

export function sha256Fingerprint(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
