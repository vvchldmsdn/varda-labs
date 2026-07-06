import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import {
  parseBooleanQuery,
  parseDateKeyQuery,
  parseEnumQuery,
} from "@/lib/http-query";
import {
  DailySnapshotRequestError,
  runDailySnapshot,
  type SnapshotAccount,
} from "@/lib/snapshots/daily";

const SNAPSHOT_ACCOUNTS = ["brokerage", "isa", "irp", "all"] as const;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedAdminJob(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = parseBooleanQuery(url.searchParams.get("dryRun"), true);
  const confirmWrite = parseBooleanQuery(
    url.searchParams.get("confirmWrite"),
    false,
  );
  const snapshotDate = parseDateKeyQuery(url.searchParams.get("date"), {
    emptyAsUndefined: true,
  });
  const account = parseAccount(url.searchParams.get("account"));

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

  if (account === null) {
    return NextResponse.json(
      { error: "account must be one of: brokerage, isa, irp, all" },
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
    const result = await runDailySnapshot({
      dryRun,
      snapshotDate,
      account,
    });
    return NextResponse.json(result);
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

function parseAccount(value: string | null): SnapshotAccount | null {
  return parseEnumQuery(value, SNAPSHOT_ACCOUNTS, "all");
}
