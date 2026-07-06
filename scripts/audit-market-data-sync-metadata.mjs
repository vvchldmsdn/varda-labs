import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const DEFAULT_LIMIT = 25;
const SENSITIVE_KEY_PATTERN =
  /^(authorization|headers?|appkey|appsecret|access_?token|token|secret|password|api[_-]?key|raw(response|request)?|requestheaders|responsebody)$/i;
const SENSITIVE_VALUE_PATTERN =
  /Bearer\s+[A-Za-z0-9._~-]+|appsecret\s*[:=]|appkey\s*[:=]|access_token\s*[:=]|authorization\s*[:=]/i;

function parseArgs(argv) {
  const options = { limit: DEFAULT_LIMIT };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error("--limit must be an integer between 1 and 500");
      }
      options.limit = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function scanValue(value, path = "$") {
  const matches = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      matches.push(...scanValue(item, `${path}[${index}]`));
    });
    return matches;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        matches.push({ path: childPath, reason: "sensitive_key" });
      }
      matches.push(...scanValue(child, childPath));
    }
    return matches;
  }

  if (typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value)) {
    matches.push({ path, reason: "sensitive_value_pattern" });
  }

  return matches;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    select
      id,
      job_type,
      mode,
      source,
      status,
      started_at,
      finished_at,
      metadata_json,
      error
    from market_data_sync_runs
    order by started_at desc
    limit ${options.limit}
  `;

  const matches = rows.flatMap((row) => {
    const rowMatches = [
      ...scanValue(row.metadata_json, "$.metadata_json"),
      ...scanValue(row.error, "$.error"),
    ];

    return rowMatches.map((match) => ({
      id: row.id,
      jobType: row.job_type,
      mode: row.mode,
      source: row.source,
      status: row.status,
      startedAt: row.started_at,
      ...match,
    }));
  });

  const result = {
    audit: "market_data_sync_runs_metadata_secrets",
    readOnly: true,
    checkedRows: rows.length,
    matchCount: matches.length,
    ok: matches.length === 0,
    matches,
  };

  console.log(JSON.stringify(result, null, 2));

  if (matches.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
