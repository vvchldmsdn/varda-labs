import "server-only";




import {
  getReadOnlyTenantHoldingAnalysisDataReadiness,
  getReadOnlyTenantHoldingAnalysisPreparationTarget,
} from "@/db/queries/holding-analysis-data-readiness";

import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  parseHoldingAnalysisDataPreparationInput,
  type HoldingAnalysisDataPreparationActionState,
} from "@/lib/holding-analysis-data-readiness";
import { enqueueMarketCollection } from "@/lib/market-data/collection-queue";
import { scheduleMarketCollection } from "@/lib/market-data/collection-worker";

import {
  getKisProviderPolicy,
} from "@/lib/market-data/providers/kis";
import { shiftRiskDate } from "@/lib/portfolio-risk-calendar";
import {
  closeCalendarReferenceDateForAsset,
  resolveSnapshotCycle,
} from "@/lib/snapshots/market-calendar";

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

    const ticker = target.ticker?.trim().toUpperCase();
    if (!ticker) {
      return state("invalid", "자동 조회에 필요한 티커가 없습니다.");
    }
    const endDate = closeCalendarReferenceDateForAsset(target, serviceDate);
    const startDate = shiftRiskDate(
      endDate,
      -(HISTORY_WINDOW_CALENDAR_DAYS - 1),
    );
    await enqueueMarketCollection([{ kind: "history", ticker, market: target.market, currency: target.currency, startDate, endDate }]);
    scheduleMarketCollection();
    return Object.freeze({ status: "queued" as const, message: "과거 가격 준비를 접수했습니다. 저장된 범위부터 분석하며 준비 상황을 자동으로 확인합니다.", retryAfterSeconds: 10 });
  } catch {
    return state("error", "과거 가격 준비 요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

function state(status: HoldingAnalysisDataPreparationActionState["status"], message: string): HoldingAnalysisDataPreparationActionState {
  return Object.freeze({ status, message });
}
