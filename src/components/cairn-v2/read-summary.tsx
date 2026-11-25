"use client";
import type { BetaView, DomainRead } from "@/lib/cairn-v2/read-contract";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { ValueDetail } from "./value-detail";
import { TodayDetail } from "./today-detail";
import { OriginalValueDetail } from "./original-value-detail";

export function ReadSummary({kind,view,context,read}:{kind:"value"|"today";view:BetaView;context:BetaContext;read?:Pick<DomainRead,"displayBinding"|"readReceipt">}) {
  return kind === "value" ? view.domain?.currentValuePresentation
    ? <OriginalValueDetail read={view.domain.currentValuePresentation} context={context} view={view} />
    : <ValueDetail view={view} context={context} /> : <TodayDetail view={view} context={context} read={read} />;
}
