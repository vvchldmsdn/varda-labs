import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  getReadOnlyTenantHoldingAnalysisDataReadiness,
  getReadOnlyTenantHoldingAnalysisPreparationTarget,
} from "@/db/queries/holding-analysis-data-readiness";
import { marketDataSyncRuns } from "@/db/schema";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  evaluateHoldingAnalysisDataCooldown,
  parseHoldingAnalysisDataPreparationInput,
  type HoldingAnalysisDataPreparationActionState,
} from "@/lib/holding-analysis-data-readiness";
import { runKisHistoryCacheSync } from "@/lib/market-data/kis-history-cache-sync";
import {
  createKisMarketDataProvider,
  getKisProviderPolicy,
} from "@/lib/market-data/providers/kis";
import { shiftRiskDate } from "@/lib/portfolio-risk-calendar";
import {
  closeCalendarReferenceDateForAsset,
  resolveSnapshotCycle,
} from "@/lib/snapshots/market-calendar";

const DEFAULT_KIS_JOB_COOLDOWN_SECONDS = 90;
const HISTORY_WINDOW_CALENDAR_DAYS = 400;

export async function prepareSessionHoldingAnalysisData(
  formData: FormData,
): Promise<HoldingAnalysisDataPreparationActionState> {
  const parsed = parseHoldingAnalysisDataPreparationInput(formData);
  if (!parsed.ok) return state("invalid", parsed.message);

  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return state("unauthorized", "로그인과 사용자 연결을 확인해 주세요.");
  }

  const now = new Date();
  const serviceDate = resolveSnapshotCycle(now).snapshotDate;
  try {
    const target = await getReadOnlyTenantHoldingAnalysisPreparationTarget({
      tenantContext: resolution.tenantContext,
      holdingId: parsed.holdingId,
    });
    if (!target) {
      return state(
        "conflict",
        "보유종목 또는 계좌 상태가 변경되었습니다. 화면을 새로고침해 주세요.",
      );
    }

    const readiness = await getReadOnlyTenantHoldingAnalysisDataReadiness({
      tenantContext: resolution.tenantContext,
      serviceDate,
      holdings: [target],
    });
    if (readiness.state !== "ready" || readiness.entries.length !== 1) {
      return state(
        "error",
        "저장된 분석 데이터 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
      );
    }
    const current = readiness.entries[0];
    if (current.state === "ready") {
      return state(
        "already_ready",
        "이미 현재 분석에 필요한 가격 기록이 준비되어 있습니다.",
      );
    }
    if (current.state === "unsupported") {
      return state(
        "invalid",
        current.reason === "manual_history_required"
          ? "금현물은 자동 조회 대신 저장된 수동 평가 기록을 사용합니다."
          : current.reason === "managed_sleeve_excluded"
            ? "일임·관리형 상품은 투자 랩·시뮬레이션 계산 대상에서 제외합니다."
          : "이 보유종목은 자동 과거 가격 준비 대상이 아닙니다.",
      );
    }
    if (current.state === "blocked") {
      return state(
        "conflict",
        "현재 사용자 범위에서는 이 가격 기록을 분석에 사용할 수 없습니다.",
      );
    }

    const providerPolicy = getKisProviderPolicy();
    if (!providerPolicy.configured) {
      return state(
        "error",
        "KIS 가격 조회 설정을 확인한 뒤 다시 시도해 주세요.",
      );
    }

    const lastActivityAt = await getLatestKisActivityAt();
    const cooldown = evaluateHoldingAnalysisDataCooldown({
      now,
      lastActivityAt,
      cooldownSeconds: resolveKisCooldownSeconds(),
    });
    if (!cooldown.ready) {
      return Object.freeze({
        status: "busy" as const,
        message: `다른 가격 조회 직후입니다. ${cooldown.retryAfterSeconds}초 후 다시 시도해 주세요.`,
        retryAfterSeconds: cooldown.retryAfterSeconds,
      });
    }

    const ticker = target.ticker?.trim().toUpperCase();
    if (!ticker) {
      return state("invalid", "자동 조회에 필요한 티커가 없습니다.");
    }
    const endDate = closeCalendarReferenceDateForAsset(target, serviceDate);
    const startDate = shiftRiskDate(
      endDate,
      -(HISTORY_WINDOW_CALENDAR_DAYS - 1),
    );
    const result = await runKisHistoryCacheSync({
      targets: [
        {
          key: [target.market, target.currency, ticker].join("|"),
          ticker,
          market: target.market,
          currency: target.currency,
          accounts: [],
          assetIds: [],
          assetNames: [],
        },
      ],
      startDate,
      endDate,
      provider: createKisMarketDataProvider(),
    });

    return state(
      "success",
      result.failedCount > 0
        ? `가격 기록 ${result.fetchedRowCount}개를 확인했습니다. 일부 구간은 제공자 응답이 없어 저장된 범위만 사용합니다.`
        : `가격 기록 ${result.fetchedRowCount}개를 확인해 분석 데이터로 준비했습니다.`,
    );
  } catch {
    return state(
      "error",
      "과거 가격을 준비하지 못했습니다. 저장된 데이터는 변경하지 않고 중단했습니다.",
    );
  }
}

async function getLatestKisActivityAt() {
  const rows = await db
    .select({
      startedAt: marketDataSyncRuns.startedAt,
      finishedAt: marketDataSyncRuns.finishedAt,
    })
    .from(marketDataSyncRuns)
    .where(eq(marketDataSyncRuns.source, "kis"))
    .orderBy(desc(marketDataSyncRuns.startedAt))
    .limit(1);
  return rows[0]?.finishedAt ?? rows[0]?.startedAt ?? null;
}

function resolveKisCooldownSeconds() {
  const configured = Number(process.env.KIS_JOB_COOLDOWN_SECONDS);
  return Number.isSafeInteger(configured) && configured >= 0 && configured <= 600
    ? configured
    : DEFAULT_KIS_JOB_COOLDOWN_SECONDS;
}

function state(
  status: HoldingAnalysisDataPreparationActionState["status"],
  message: string,
): HoldingAnalysisDataPreparationActionState {
  return Object.freeze({ status, message });
}
