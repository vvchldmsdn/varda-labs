"use client";
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { useI18n } from "@/components/i18n/locale-provider";


import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useCallback, useState, useTransition } from "react";

import { useMarketCollectionPolling } from "@/components/use-market-collection-polling";
import { Button as CairnButton } from "@/components/cairn-ui";


type SyncState = "idle" | "syncing" | "fresh" | "partial" | "cooldown" | "queued" | "waiting" | "error";
type SyncResponse = {
  state?: string;
};

let activeSyncRequest: Promise<SyncResponse> | null = null;

export function PortfolioRefreshButton({
  compact = false,
  designPreview = false,
}: {
  compact?: boolean;
  designPreview?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [refreshPending, startTransition] = useTransition();
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [collectionGeneration, setCollectionGeneration] = useState(0);
  const collectionState = useMarketCollectionPolling(syncState === "queued" && !designPreview, collectionGeneration);
  const displayState = syncState === "queued" && collectionState === "partial" ? "partial" : syncState === "queued" && ["fresh", "empty"].includes(collectionState ?? "") ? "fresh" : syncState === "queued" && collectionState === "waiting" ? "waiting" : syncState;
  const pending = syncState === "syncing" || refreshPending;

  const sync = useCallback(
    async () => {
      setSyncState("syncing");

      try {
        const result = await requestLivePriceSync();

        if (result.state === "synced") setSyncState("fresh");
        else if (result.state === "queued") {
          // Each manual attempt owns a new bounded polling window,
          // including a fast response batched with the previous queued state.
          setCollectionGeneration(generation => generation + 1);
          setSyncState("queued");
        }
        else if (result.state === "partial") setSyncState("partial");
        else if (result.state === "fresh" || result.state === "empty") {
          setSyncState("fresh");
        } else if (result.state === "cooldown") {
          setSyncState("cooldown");
        } else {
          setSyncState("error");
        }

        if (
          result.state === "synced" ||
          result.state === "partial" ||
          result.state === "fresh" ||
          result.state === "empty" ||
          result.state === "cooldown"
        ) {
          startTransition(() => router.refresh());
        }
      } catch {
        setSyncState("error");
      }
    },
    [router],
  );

  return (
    <CairnButton variant="secondary"
      type="button"
      aria-label={t("실시간 시세 갱신", "Refresh live prices")}
      className={
        compact
          ? "grid h-9 w-9 place-items-center text-xl text-[var(--ink)] transition-colors hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] disabled:opacity-40"
          : "inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium text-[var(--ink)] transition-colors hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] disabled:opacity-40"
      }
      disabled={pending}
      onClick={() => designPreview ? startTransition(() => router.refresh()) : void sync()}
      title={t(designPreview ? "디자인 미리보기 새로고침" : syncTitle(displayState), translateHomeHistory(designPreview ? "디자인 미리보기 새로고침" : syncTitle(displayState)))}
    >
      <span aria-hidden="true" className={pending ? "animate-spin" : undefined}>
        <RefreshCw size={15} strokeWidth={1.5} />
      </span>
      {compact ? null : <span aria-live="polite">{<T ko={syncLabel(displayState)} en={displayState === "queued" ? "Refresh queued" : displayState === "waiting" ? "Pending · check again" : translateHomeHistory(syncLabel(displayState))}/>}</span>}
    </CairnButton>
  );
}

function requestLivePriceSync() {
  if (activeSyncRequest) return activeSyncRequest;

  activeSyncRequest = fetch("/api/portfolio/live-prices/sync", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual" }),
  })
    .then(async (response) => {
      const body = (await response.json()) as SyncResponse;
      if (!response.ok && body.state !== "cooldown") {
        throw new Error("Live price sync failed");
      }
      return body;
    })
    .finally(() => {
      activeSyncRequest = null;
    });

  return activeSyncRequest;
}

function syncLabel(state: SyncState) {
  if (state === "queued") return "시세 갱신 대기 중";
  if (state === "waiting") return "대기 중 · 다시 확인";
  if (state === "syncing") return "시세 확인 중";
  if (state === "fresh") return "최신 시세 반영됨";
  if (state === "partial") return "일부 시세 반영됨";
  if (state === "cooldown") return "잠시 후 다시 시도";
  if (state === "error") return "갱신 실패 · 다시 시도";
  return "실시간 시세 갱신";
}

function syncTitle(state: SyncState) {
  if (state === "cooldown") return "공급자 보호 시간 후 다시 시도할 수 있습니다";
  if (state === "error") return "시세 갱신에 실패했습니다. 다시 누르면 재시도합니다";
  return "소유한 보유 종목의 최신 시세를 확인합니다";
}
