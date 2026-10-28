"use client";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { ValueDetail } from "./value-detail";
import { TodayDetail } from "./today-detail";

export function ReadSummary({kind,view,context}:{kind:"value"|"today";view:BetaView;context:BetaContext}) {
  return kind === "value" ? <ValueDetail view={view} context={context} /> : <TodayDetail view={view} context={context} />;
}
