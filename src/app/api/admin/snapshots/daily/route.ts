import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import {
  parseBooleanQuery,
  parseDateKeyQuery,
} from "@/lib/http-query";
import {
  DailySnapshotRequestError,
} from "@/lib/snapshots/daily";
import { runDailySnapshotJob } from "@/lib/snapshots/daily-job";

const ALLOWED_QUERY_KEYS = new Set([
  "dryrun",
  "confirmwrite",
  "date",
]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedAdminJob(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  if (hasUnsupportedQuery(url.searchParams)) {
    return NextResponse.json(
      { error: "unsupported query parameter" },
      { status: 400 },
    );
  }

  const dryRun = parseBooleanQuery(url.searchParams.get("dryRun"), true);
  const confirmWrite = parseBooleanQuery(
    url.searchParams.get("confirmWrite"),
    false,
  );
  const snapshotDate = parseDateKeyQuery(url.searchParams.get("date"), {
    emptyAsUndefined: true,
  });
  if (dryRun === null) {
    return NextResponse.json(
      { error: "dryRun must be true or false when provided" },
      { status: 400 },
    );
  }

  if (confirmWrite === null) {
    return NextResponse.json(
      { error: "confirmWrite must be true or false when provided" },
      { status: 400 },
    );
  }

  if (snapshotDate === null) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD when provided" },
      { status: 400 },
    );
  }

  if (!dryRun && !confirmWrite) {
    return NextResponse.json(
      {
        error:
          "daily snapshot writes require dryRun=false and confirmWrite=true",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runDailySnapshotJob({
      dryRun,
      snapshotDate,
    });
    const status =
      dryRun || result.ok ? 200 : result.writtenCount > 0 ? 207 : 409;
    return NextResponse.json(result, { status });
  } catch (error) {
    if (error instanceof DailySnapshotRequestError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
        },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      { error: "daily snapshot failed" },
      { status: 500 },
    );
  }
}

function hasUnsupportedQuery(searchParams: URLSearchParams) {
  return [...searchParams.keys()].some(
    (key) => !ALLOWED_QUERY_KEYS.has(key.trim().toLowerCase()),
  );
}
