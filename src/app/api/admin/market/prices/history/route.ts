import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import {
  KIS_HISTORY_PREVIEW_POLICY,
  KisHistoryPreviewInputError,
  parseKisHistoryPreviewRequest,
  summarizeKisHistoryPreview,
} from "@/lib/market-data/kis-history-preview";
import {
  createKisMarketDataProvider,
  getKisProviderPolicy,
} from "@/lib/market-data/providers/kis";
import { KisRawHistoryInputError } from "@/lib/market-data/providers/kis-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedAdminJob(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "request body must be valid JSON" },
      { status: 400 },
    );
  }

  let previewRequest;
  try {
    previewRequest = parseKisHistoryPreviewRequest(body);
  } catch (error) {
    if (error instanceof KisHistoryPreviewInputError) {
      return NextResponse.json(
        { error: "invalid_kis_history_preview", message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "invalid_kis_history_preview" },
      { status: 400 },
    );
  }

  const providerPolicy = getKisProviderPolicy();
  if (!providerPolicy.configured) {
    return NextResponse.json(
      {
        error: "KIS provider is not configured",
        provider: "kis",
        missingEnvKeys: providerPolicy.missingEnvKeys,
      },
      { status: 503 },
    );
  }

  try {
    const provider = createKisMarketDataProvider();
    if (!provider.fetchHistoricalClosePrices) {
      return NextResponse.json(
        { error: "KIS historical provider is unavailable" },
        { status: 503 },
      );
    }

    const result = await provider.fetchHistoricalClosePrices(
      [...previewRequest.targets],
      {
        dryRun: true,
        requestedAt: new Date(),
        startDate: previewRequest.startDate,
        endDate: previewRequest.endDate,
      },
    );
    return NextResponse.json(summarizeKisHistoryPreview(result));
  } catch (error) {
    if (error instanceof KisRawHistoryInputError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "KIS historical preview failed",
        policy: KIS_HISTORY_PREVIEW_POLICY.version,
      },
      { status: 502 },
    );
  }
}
