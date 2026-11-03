"use client";
import { CurrencyTrackedView } from "@/components/currency-tracked-view";
import { useI18n } from "@/components/i18n/locale-provider";
import { originalLegacyValueView, type OriginalCurrentValuePresentation } from "@/lib/cairn-v2/current-value-presentation";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { ValueDetail } from "./value-detail";
import styles from "./value-detail.module.css";

/** Reuse the original native view or the existing beta legacy composition. */
export function OriginalValueDetail({read,context,view}:{read:OriginalCurrentValuePresentation;context:BetaContext;view:BetaView}) {
  const {t}=useI18n();
  if(read.kind === "unavailable")return <p className={styles.empty} role="status">{t("현재 평가를 불러오지 못했어요. 다시 조회해 주세요.","Current valuation is unavailable. Please retry.")}</p>;
  if(read.kind === "tracked")return read.evidence.reporting !== context.currency ? <p role="status">{t("새 조회 범위를 확인하는 중","Checking the requested scope")}</p> :
    <CurrencyTrackedView key={`${read.evidence.ownerId}:${context.scope}`} evidence={read.evidence} reports={read.reports} surface="structure" hideCurrencyControl embedded />;
  if(context.currency !== "KRW")return <p role="status">{t("새 조회 범위를 확인하는 중","Checking the requested scope")}</p>;
  return <ValueDetail view={originalLegacyValueView(view,read)} context={context} />;
}
