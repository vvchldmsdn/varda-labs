"use client";
import { useMemo, useLayoutEffect } from "react";
import { useBetaReadFreshness } from "./beta-provider";
import { getFixtureView } from "@/lib/cairn-v2/fixtures";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { blankDomainView, visibleDomainRead, type DomainRead, type BetaView } from "@/lib/cairn-v2/read-contract";
export function useBetaView(context: BetaContext, read?: DomainRead): BetaView {
  const freshness = useBetaReadFreshness();
  const epoch = freshness?.epoch;
  const observed = freshness?.observed;
  const store = freshness?.store;
  useLayoutEffect(() => {
    if (context.mode !== "domain") store?.leaveDomain();
    observed?.(context.mode === "domain" ? read?.readReceipt : undefined, read?.readEpoch);
  }, [context.mode, read?.readReceipt, read?.readEpoch, observed, epoch, store]);
  return useMemo(() => context.mode === "domain" ? freshness?.store.blocked(read?.readReceipt, read?.readEpoch) ?
    blankDomainView("loading", "사용자와 조회 권한을 다시 확인하는 중") : read ? visibleDomainRead(read, context) :
    blankDomainView("unavailable", "읽기 응답 없음") : getFixtureView(context), [context, read, freshness]);
}
