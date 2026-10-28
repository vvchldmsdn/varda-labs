"use client";
import { Button as CairnButton } from "@/components/cairn-ui";

import { useBetaPreferences } from "./beta-provider";
import styles from "./beta.module.css";

/** Existing home/detail controls; state ownership and button semantics are unchanged. */
export function MetricControls({ compact = false }: { compact?: boolean }) {
  const { metric, setMetric } = useBetaPreferences();
  return <div className={compact ? styles.segmented : styles.textTabs} role="group" aria-label="히스토리 보기">
    <CairnButton variant="bare" type="button" aria-pressed={metric === "value"} onClick={() => setMetric("value")}>평가액</CairnButton>
    <CairnButton variant="bare" type="button" aria-pressed={metric === "return"} onClick={() => setMetric("return")}>수익률</CairnButton>
  </div>;
}
