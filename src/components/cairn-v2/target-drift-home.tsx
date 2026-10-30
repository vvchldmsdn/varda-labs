"use client";
import { Button as CairnButton } from "@/components/cairn-ui";

import Image from "next/image";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { driftNumber, targetMessage } from "@/lib/cairn-v2/target-presentation";
import styles from "./beta.module.css";
import home from "./target-drift-home.module.css";

export function TargetDriftHome({ view, onOpen }: { view: BetaView; onOpen: (trigger: HTMLElement) => void }) {
  const target = view.domain?.planning?.targets.state === "ready" ? view.domain.planning.targets.maxDrift : null;
  const drift = view.domain ? target?.driftPct : view.drift ? view.drift.weightPct - view.drift.targetPct : null;
  const known = drift !== null && drift !== undefined && Number.isFinite(drift);
  const name = view.domain ? target?.name : view.drift?.name;
  const label = !known ? "목표 비중 비교" : drift > 0 ? "목표보다 많음" : drift < 0 ? "목표보다 적음" : "목표와 일치";
  const unavailable = view.domain ? targetMessage(view) : "목표 없음";
  const explanation = known ? (name ?? "종목") + " · 현재 비중 − 승인 목표의 가장 큰 차이 " + driftNumber(drift, 2) + "%p. 수익률이 아닙니다." : unavailable;
  return <section className={styles.card + " " + styles.drift} data-beta-card="drift">
    <CairnButton variant="bare" type="button" className={styles.driftButton + " " + home.button} id="beta-target-drift" aria-label="목표 편차 확대" title={explanation} data-expand onClick={event => onOpen(event.currentTarget)}>
      <span>{label}<Image unoptimized src="/cairn-v2/figma/75-305-28460.svg" width="12" height="12" alt="" /></span>
      <strong>{driftNumber(drift)}<small>%p</small></strong>
      <span className={home.name} title={name ?? unavailable}>{known ? name : unavailable}</span>
      <span className={styles.visuallyHidden}>{explanation}</span>
    </CairnButton>
  </section>;
}
