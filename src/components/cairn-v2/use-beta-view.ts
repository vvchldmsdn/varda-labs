"use client";
import { useMemo, useLayoutEffect } from "react";
import { useBetaReadFreshness } from "./beta-provider";
import { getFixtureView } from "@/lib/cairn-v2/fixtures";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { blankDomainView, requestKey, visibleDomainRead, type DomainRead, type BetaView } from "@/lib/cairn-v2/read-contract";
export function useBetaView(context: BetaContext, read?: DomainRead, retainContributionPreview = false): BetaView {
  const freshness = useBetaReadFreshness();
  const epoch = freshness?.epoch;
  const observed = freshness?.observed;
  const store = freshness?.store;
  useLayoutEffect(() => {
    if (context.mode !== "domain") store?.leaveDomain();
    observed?.(context.mode === "domain" ? read?.readReceipt : undefined, read?.readEpoch, context.mode === "domain" ? read?.displayBinding : undefined);
  }, [context.mode, read?.readReceipt, read?.readEpoch, read?.displayBinding, observed, epoch, store]);
  return useMemo(() => {
    if (context.mode !== "domain") return getFixtureView(context);
    if (freshness?.store.blocked(read?.readReceipt, read?.readEpoch))
      return blankDomainView("loading", "사용자와 조회 권한을 다시 확인하는 중");
    if (!read) return blankDomainView("unavailable", "읽기 응답 없음");
    // A change to hypothetical funding leaves account/currency/holdings data scoped
    // identically. The preview and modal compare the received amount with the input.
    if (retainContributionPreview && read.context.cashAmountKrw !== context.cashAmountKrw &&
      requestKey({ ...read.context, cashAmountKrw: context.cashAmountKrw }) === requestKey(context)) return read.view;
    return visibleDomainRead(read, context);
  }, [context, read, freshness, retainContributionPreview]);
}
