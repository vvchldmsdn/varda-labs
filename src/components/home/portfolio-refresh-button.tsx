"use client";
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { useI18n } from "@/components/i18n/locale-provider";


import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { useMarketCollectionPolling } from "@/components/use-market-collection-polling";
import { Button as CairnButton } from "@/components/cairn-ui";
import type { QuoteRefreshResponse } from "@/lib/market-data/quote-refresh-progress";


type SyncState = "idle" | "syncing" | "fresh" | "partial" | "cooldown" | "queued" | "waiting" | "error";
type SyncResponse = QuoteRefreshResponse;

let activeSyncRequest: { promise: Promise<SyncResponse>; controller: AbortController } | null = null;
let mountedRefreshButtons = 0;

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
  const [receipt, setReceipt] = useState<SyncResponse | null>(null);
  const [startedAt, setStartedAt] = useState<string | undefined>();
  const mounted = useRef<{ active: boolean } | null>(null);
  useEffect(() => {
    if (designPreview) return;
    const lifetime = { active: true };
    mounted.current = lifetime;
    mountedRefreshButtons++;
    return () => {
      lifetime.active = false;
      if (--mountedRefreshButtons === 0) {
        activeSyncRequest?.controller.abort();
        activeSyncRequest = null;
      }
    };
  }, [designPreview]);
  const progressChanged = useCallback((data: SyncResponse) => setReceipt(data), []);
  const collectionState = useMarketCollectionPolling(syncState === "queued" && !designPreview, collectionGeneration, false, startedAt, progressChanged);
  const displayState = syncState === "queued" && collectionState === "partial" ? "partial" : syncState === "queued" && ["fresh", "empty"].includes(collectionState ?? "") ? "fresh" : syncState === "queued" && collectionState === "waiting" ? "waiting" : syncState;
  const pending = syncState === "syncing" || displayState === "queued" || refreshPending;

  const sync = useCallback(
    async () => {
      const lifetime = mounted.current;
      if (!lifetime?.active) return;
      setSyncState("syncing");
      setReceipt(null);

      try {
        const result = await requestLivePriceSync();
        if (!lifetime.active) return;
        setReceipt(result);
        setStartedAt(result.startedAt ?? new Date().toISOString());

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
        if (lifetime.active) setSyncState("error");
      }
    },
    [router],
  );

  return (
    <div className="relative inline-flex items-center gap-2">
    <CairnButton variant="secondary"
      type="button"
      aria-label={t("실시간 시세 갱신", "Refresh live prices")}
      className={
        compact
          ? "grid h-9 w-9 place-items-center text-xl text-[var(--ink)] transition-colors hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] disabled:opacity-40"
          : "inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium text-[var(--ink)] transition-colors hover:text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] disabled:opacity-40"
      }
      disabled={pending}
      aria-busy={pending}
      onClick={() => designPreview ? startTransition(() => router.refresh()) : void sync()}
      title={t(designPreview ? "디자인 미리보기 새로고침" : syncTitle(displayState), translateHomeHistory(designPreview ? "디자인 미리보기 새로고침" : syncTitle(displayState)))}
    >
      <span aria-hidden="true" className={pending ? "animate-spin motion-reduce:animate-none" : undefined}>
        <RefreshCw size={15} strokeWidth={1.5} />
      </span>
      {compact ? null : <span aria-live="polite">{<T ko={syncLabel(displayState)} en={displayState === "queued" ? "Refresh queued" : displayState === "waiting" ? "Pending · check again" : translateHomeHistory(syncLabel(displayState))}/>}</span>}
    </CairnButton>
    {compact && !receipt?.progress && ["error", "cooldown", "waiting"].includes(displayState) && <span role="status" className="text-xs">{syncLabel(displayState)}</span>}
    {receipt?.progress && <details className="text-xs">
      <summary className="cursor-pointer whitespace-nowrap py-2" aria-live="polite">
        {receipt.progress.completed}/{receipt.progress.total} {t("조회", "checked")}
        {displayState === "queued" ? t(" · 진행 중", " · in progress") : displayState === "waiting" ? t(" · 확인 중단", " · paused") : receipt.progress.failed ? t(" · 일부 실패", " · incomplete") : t(" · 완료", " · complete")}
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 max-h-80 w-[min(340px,calc(100vw-32px))] overflow-y-auto border border-[var(--line)] bg-[var(--paper)] p-4 text-[var(--ink)] shadow-sm">
        <p className="mb-3">{t("종목·환율 조회 결과", "Quote and exchange-rate checks")}</p>
        {displayState === "waiting" && <p role="status" className="mb-3">{t("확인 시간이 길어져 멈췄어요. 완료되지 않은 항목은 다시 갱신할 수 있어요.", "Checking timed out. You can retry the remaining items.")}</p>}
        {collectionState === "unavailable" && <p role="status">{t("연결을 다시 확인하고 있어요.", "Retrying the connection.")}</p>}
        <ul>{receipt.progress.items.map(item => <li key={item.id} className="border-t border-[var(--line)] py-2">
          <div className="flex justify-between gap-3"><span>{item.label} <small>{item.provider}</small></span><span>{t(...progressLabel(item.state))}</span></div>
          {item.priceAsOf && <p className="mt-1 text-[var(--muted)]">{t("가격 기준", "Price as of")} {formatTime(item.priceAsOf)}</p>}
          {item.checkedAt && <p className="text-[var(--muted)]">{t("조회", "Checked")} {formatTime(item.checkedAt)}</p>}
          {item.retryAt && <p className="text-[var(--muted)]">{t("재시도 예정", "Next retry")} {formatTime(item.retryAt)}</p>}
        </li>)}</ul>
        <p className="mt-2 text-[var(--muted)]">{t("장 마감 후에는 조회가 끝나도 가격 기준 시각이 같을 수 있어요.", "After market close, a completed check can return the same price timestamp.")}</p>
      </div>
    </details>}
    </div>
  );
}

function requestLivePriceSync() {
  if (activeSyncRequest) return activeSyncRequest.promise;

  const controller = new AbortController();
  const request = fetch("/api/portfolio/live-prices/sync", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
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
      if (activeSyncRequest?.promise === request) activeSyncRequest = null;
    });

  activeSyncRequest = { promise: request, controller };
  return request;
}

function syncLabel(state: SyncState) {
  if (state === "queued") return "시세 갱신 대기 중";
  if (state === "waiting") return "대기 중 · 다시 확인";
  if (state === "syncing") return "시세 확인 중";
  if (state === "fresh") return "시세 조회 완료";
  if (state === "partial") return "일부 시세 반영됨";
  if (state === "cooldown") return "잠시 후 다시 시도";
  if (state === "error") return "갱신 실패 · 다시 시도";
  return "실시간 시세 갱신";
}

function progressLabel(state: string): [string, string] {
  if (state === "ready") return ["확인 완료", "Checked"];
  if (state === "pending") return ["대기", "Queued"];
  if (state === "running") return ["조회 중", "Checking"];
  if (state === "delayed") return ["재시도 대기", "Retry scheduled"];
  if (state === "failed") return ["조회 실패", "Failed"];
  return ["확인 불가", "Unavailable"];
}
function formatTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " KST";
}

function syncTitle(state: SyncState) {
  if (state === "cooldown") return "공급자 보호 시간 후 다시 시도할 수 있습니다";
  if (state === "error") return "시세 갱신에 실패했습니다. 다시 누르면 재시도합니다";
  return "소유한 보유 종목의 최신 시세를 확인합니다";
}
