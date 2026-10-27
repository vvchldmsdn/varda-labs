"use client";
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { useI18n } from "@/components/i18n/locale-provider";


import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";

import { TENANT_LIVE_PRICE_SYNC_POLICY } from "@/lib/market-data/tenant-live-price-sync-policy";
import { useMarketCollectionPolling } from "@/components/use-market-collection-polling";

type SyncState = "idle" | "syncing" | "fresh" | "partial" | "cooldown" | "queued" | "waiting" | "error";
type SyncResponse = {
  state?: string;
};

let activeSyncRequest: Promise<SyncResponse> | null = null;

export function PortfolioRefreshButton({
  autoSync = false,
  compact = false,
  designPreview = false,
}: {
  autoSync?: boolean;
  compact?: boolean;
  designPreview?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [refreshPending, startTransition] = useTransition();
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const collectionState = useMarketCollectionPolling(syncState === "queued" && !designPreview);
  const displayState = syncState === "queued" && collectionState === "fresh" ? "fresh" : syncState === "queued" && collectionState === "waiting" ? "waiting" : syncState;
  const pending = syncState === "syncing" || refreshPending;

  const sync = useCallback(
    async (reason: "page_view" | "manual") => {
      setSyncState("syncing");

      try {
        const result = await requestLivePriceSync(reason);

        if (result.state === "synced") setSyncState("fresh");
        else if (result.state === "queued") setSyncState("queued");
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

  useEffect(() => {
    if (!autoSync || designPreview) return;

    let lastBucket: number | null = null;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const bucket = Math.floor(Date.now() / TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds);
      const key = "varda:live-price-sync:last-bucket";
      if (lastBucket === bucket) return;
      lastBucket = bucket;
      try {
        if (window.sessionStorage.getItem(key) === String(bucket)) return;
        // Keep one bucket and tolerate browsers that disable session storage.
        window.sessionStorage.setItem(key, String(bucket));
      } catch {
        // The effect-local bucket still prevents duplicate focus/visibility requests.
      }
      void sync("page_view");
    };
    const timeout = window.setTimeout(check, 0);
    const interval = window.setInterval(check, TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [autoSync, designPreview, sync]);

  return (
    <button
      type="button"
      aria-label={t("실시간 시세 갱신", "Refresh live prices")}
      className={
        compact
          ? "grid h-9 w-9 place-items-center text-xl text-[var(--ink)] transition-colors hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] disabled:opacity-40"
          : "inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium text-[var(--ink)] transition-colors hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] disabled:opacity-40"
      }
      disabled={pending}
      onClick={() => designPreview ? startTransition(() => router.refresh()) : void sync("manual")}
      title={t(designPreview ? "디자인 미리보기 새로고침" : syncTitle(displayState), translateHomeHistory(designPreview ? "디자인 미리보기 새로고침" : syncTitle(displayState)))}
    >
      <span aria-hidden="true" className={pending ? "animate-spin" : undefined}>
        <RefreshCw size={15} strokeWidth={1.5} />
      </span>
      {compact ? null : <span aria-live="polite">{<T ko={syncLabel(displayState)} en={displayState === "queued" ? "Refresh queued" : displayState === "waiting" ? "Pending · check again" : translateHomeHistory(syncLabel(displayState))}/>}</span>}
    </button>
  );
}

function requestLivePriceSync(reason: "page_view" | "manual") {
  if (activeSyncRequest) return activeSyncRequest;

  activeSyncRequest = fetch("/api/portfolio/live-prices/sync", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
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
