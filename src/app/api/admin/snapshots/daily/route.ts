import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import {
  DailySnapshotRequestError,
  runDailySnapshot,
  type SnapshotAccount,
} from "@/lib/snapshots/daily";

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
  const snapshotDate = parseDate(url.searchParams.get("date"));
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

function parseBooleanQuery(value: string | null, defaultValue: boolean) {
  if (value === null) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function parseDate(value: string | null) {
  if (value === null || value.trim() === "") return undefined;
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function parseAccount(value: string | null): SnapshotAccount | null {
  if (value === null || value.trim() === "") return "all";

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "brokerage" ||
    normalized === "isa" ||
    normalized === "irp" ||
    normalized === "all"
  ) {
    return normalized;
  }

  return null;
}
