"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { RecoveryTitle } from "@/components/recovery/recovery-notice";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { eventNumber } from "@/lib/cairn-v2/event-display";
import { ContributionFundingBar } from "./contribution-funding-bar";
import styles from "./home-contribution.module.css";

export function ContributionHome({ view, dirty = false, pendingAmount }: {
  view: BetaView;
  dirty?: boolean;
  pendingAmount?: number | null;
}) {
  const { t } = useI18n();
  const read = view.domain?.planning?.contribution;
  const result = !dirty && read?.state === "ready" ? read.result : null;
  const pendingLabel = pendingAmount != null ? t(`${eventNumber(pendingAmount)}원 배분 계산 중`, `Calculating the ₩${eventNumber(pendingAmount)} allocation`) : null;
  if (!result) return <div className={styles.pending} role="status" data-contribution-state={dirty ? "edited" : read?.state ?? view.domain?.state}>
    {(pendingLabel || view.domain?.state === "loading") && <span className={styles.loadingTrack} aria-hidden="true" />}
    {pendingLabel ?? (dirty ? t("변경한 금액으로 계산해 주세요", "Calculate using the edited amount") :
      read?.state === "blocked" || read?.state === "unavailable"
        ? <RecoveryTitle reasons={read.blockers} kind={read.state === "unavailable" ? "retry" : undefined} />
        : read?.message ?? t("계산할 금액을 확인해 주세요", "Check the amount to calculate"))}
  </div>;
  return <div className={styles.surface} data-contribution-state={pendingLabel ? "loading" : "ready"}>
    {pendingLabel && <p className={styles.calculating} role="status">{pendingLabel} · {t("표시 중", "Showing")} {eventNumber(result.cashAmountKrw)} KRW</p>}
    <ContributionFundingBar result={result} basis={read?.orderBasis} showLeadingBuys />
    {read?.orderBasis?.unavailable.length ? <p className={styles.calculating}>{t("일부 종목의 주문 단가·단위를 확인해 주세요.", "Some instruments need a price or order unit.")}</p> : null}
  </div>;
}
