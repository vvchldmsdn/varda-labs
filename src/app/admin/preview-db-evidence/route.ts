import { neon } from "@neondatabase/serverless";

import {
  assertReviewedPreviewDatabaseState,
  publicPreviewDatabaseEvidence,
  readPreviewDatabaseState,
} from "@/lib/deployment/preview-database-evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json(
      {
        evidenceVersion: "preview_database_evidence_v2",
        status: "not_found",
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("Preview database is not configured.");

    const sql = neon(databaseUrl);
    const state = await readPreviewDatabaseState({
      env: process.env,
      query: (text) => sql.query(text),
    });
    assertReviewedPreviewDatabaseState(state);

    return Response.json(publicPreviewDatabaseEvidence(state), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        evidenceVersion: "preview_database_evidence_v2",
        status: "blocked",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
