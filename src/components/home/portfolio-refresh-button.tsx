"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { TENANT_LIVE_PRICE_SYNC_POLICY } from "@/lib/market-data/tenant-live-price-sync-policy";

type SyncState = "idle" | "syncing" | "fresh" | "partial" | "cooldown" | "error";
type SyncResponse = {
  state?: string;
};

let activeSyncRequest: Promise<SyncResponse> | null = null;

export function PortfolioRefreshButton({
  autoSync = false,
  compact = false,
}: {
  autoSync?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [refreshPending, startTransition] = useTransition();
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const pending = syncState === "syncing" || refreshPending;

  const sync = useCallback(
    async (reason: "page_view" | "manual") => {
      setSyncState("syncing");

      try {
        const result = await requestLivePriceSync(reason);

        if (result.state === "synced") setSyncState("fresh");
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
    if (!autoSync) return;

    const bucket = Math.floor(
      Date.now() / TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds,
    );
    const key = `varda:live-price-sync:${bucket}`;
    if (window.sessionStorage.getItem(key)) return;

    window.sessionStorage.setItem(key, "attempted");
    void sync("page_view");
  }, [autoSync, sync]);

  return (
    <button
      type="button"
      aria-label="실시간 시세 갱신"
      className={
        compact
          ? "grid h-9 w-9 place-items-center text-xl text-[#252824] transition-colors hover:text-[#347e62] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62] disabled:opacity-40"
          : "inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium text-[#252824] transition-colors hover:text-[#347e62] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62] disabled:opacity-40"
      }
      disabled={pending}
      onClick={() => void sync("manual")}
      title={syncTitle(syncState)}
    >
      <span aria-hidden="true" className={pending ? "animate-spin" : undefined}>
        ↻
      </span>
      {compact ? null : <span aria-live="polite">{syncLabel(syncState)}</span>}
    </button>
  );
}

function requestLivePriceSync(reason: "page_view" | "manual") {
  if (activeSyncRequest) return activeSyncRequest;

  activeSyncRequest = fetch("/api/portfolio/live-prices/sync", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
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
