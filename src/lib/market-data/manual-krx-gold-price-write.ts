import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, assets } from "@/db/schema";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  buildManualAssetPriceUpdate,
  KRX_GOLD_MANUAL_ASSET_BINDING,
  parseManualAssetPriceInput,
  type ManualKrxGoldPriceActionState,
} from "@/lib/market-data/manual-asset-price";
import {
  assertActiveTenantWriteAllowed,
  prepareTenantWriteContext,
} from "@/lib/tenant-write-context";

export async function writeSessionManualKrxGoldPrice(
  rawPrice: unknown,
): Promise<ManualKrxGoldPriceActionState> {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return actionState(
      "unauthorized",
      "로그인과 계정 소유권을 다시 확인해 주세요.",
    );
  }

  const parsedPrice = parseManualAssetPriceInput(rawPrice);
  if (!parsedPrice.ok) {
    return actionState(
      "invalid",
      "1g 평가액을 1원 이상 1억원 이하 숫자로 입력해 주세요.",
    );
  }

  const tenantId = resolution.tenantContext.ownerUserId;

  try {
    const candidates = await db
      .select({
        assetId: assets.id,
        assetAccountId: assets.accountId,
        assetScopeId: assets.canonicalOwnerUserId,
        assetUpdatedAt: assets.updatedAt,
        accountScopeId: accounts.canonicalOwnerUserId,
      })
      .from(assets)
      .innerJoin(accounts, eq(assets.accountId, accounts.id))
      .where(
        and(
          eq(assets.canonicalOwnerUserId, tenantId),
          eq(accounts.canonicalOwnerUserId, tenantId),
          eq(accounts.isActive, true),
          eq(accounts.code, KRX_GOLD_MANUAL_ASSET_BINDING.account),
          eq(assets.account, accounts.code),
          isNull(assets.archivedAt),
          eq(assets.name, KRX_GOLD_MANUAL_ASSET_BINDING.name),
          isNull(assets.ticker),
          eq(assets.assetType, KRX_GOLD_MANUAL_ASSET_BINDING.assetType),
          eq(assets.market, KRX_GOLD_MANUAL_ASSET_BINDING.market),
          eq(assets.currency, KRX_GOLD_MANUAL_ASSET_BINDING.currency),
        ),
      )
      .limit(2);

    if (candidates.length !== 1) {
      return actionState(
        "conflict",
        "수정 가능한 금현물 보유 행을 하나로 확인할 수 없습니다.",
      );
    }

    const [candidate] = candidates;
    if (candidate.assetAccountId === null) {
      return actionState(
        "conflict",
        "금현물과 증권 계정의 연결을 확인할 수 없습니다.",
      );
    }

    const writeContext = prepareTenantWriteContext({
      mode: "active",
      source: "session",
      targetClassification: "user_owned",
      canonicalOwnerUserId: tenantId,
      canonicalOwnerStatus: "active",
      canonicalOwnerVerified: true,
    });
    assertActiveTenantWriteAllowed({
      context: writeContext,
      operation: "update",
      existingOwnerUserId: candidate.assetScopeId,
      referencedOwnerUserIds: [candidate.accountScopeId],
    });

    const updatedAt = new Date();
    const [updated] = await db
      .update(assets)
      .set({
        ...buildManualAssetPriceUpdate({
          currentPrice: parsedPrice.currentPrice,
          recordedAt: updatedAt,
        }),
        updatedAt,
      })
      .where(
        and(
          eq(assets.id, candidate.assetId),
          eq(assets.accountId, candidate.assetAccountId),
          eq(assets.canonicalOwnerUserId, tenantId),
          eq(assets.updatedAt, candidate.assetUpdatedAt),
        ),
      )
      .returning({ id: assets.id });

    if (!updated) {
      return actionState(
        "conflict",
        "다른 갱신이 먼저 반영되었습니다. 화면을 새로고침한 뒤 확인해 주세요.",
      );
    }
  } catch {
    return actionState(
      "error",
      "평가액을 저장하지 못했습니다. 데이터 연결 상태를 확인해 주세요.",
    );
  }

  return actionState("success", "금현물 1g 평가액을 저장했습니다.");
}

function actionState(
  status: ManualKrxGoldPriceActionState["status"],
  message: string,
): ManualKrxGoldPriceActionState {
  return Object.freeze({ status, message });
}
