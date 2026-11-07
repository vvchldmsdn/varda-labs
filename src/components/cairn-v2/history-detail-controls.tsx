"use client";
import { Button as CairnButton, ChoiceGroup } from "@/components/cairn-ui";

import { useBetaPreferences } from "./beta-provider";

/** Existing home/detail controls; state ownership and button semantics are unchanged. */
export function MetricControls({ compact = false }: { compact?: boolean }) {
  const { metric, setMetric } = useBetaPreferences();
  return <ChoiceGroup appearance={compact ? "segmented" : "underline"} label="히스토리 보기">
    <CairnButton variant="bare" type="button" aria-pressed={metric === "value"} onClick={() => setMetric("value")}>평가액</CairnButton>
    <CairnButton variant="bare" type="button" aria-pressed={metric === "return"} onClick={() => setMetric("return")}>수익률</CairnButton>
  </ChoiceGroup>;
}

export function PeriodControls() {
  const { period, setPeriod } = useBetaPreferences();
  return <ChoiceGroup appearance="segmented" label="조회 기간">
    {(["1M", "3M", "6M", "ALL"] as const).map(option => <CairnButton variant="bare" key={option} type="button" aria-pressed={option === period} onClick={() => setPeriod(option)}>
      {{ "1M":"1개월", "3M":"3개월", "6M":"6개월", "ALL":"전체" }[option]}
    </CairnButton>)}
  </ChoiceGroup>;
}
