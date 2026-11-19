"use client";
import { Button as CairnButton, ChoiceGroup } from "@/components/cairn-ui";

import { useBetaPreferences } from "./beta-provider";
import { useI18n } from "@/components/i18n/locale-provider";

/** Existing home/detail controls; state ownership and button semantics are unchanged. */
export function MetricControls({ compact = false, impactActive = false, onImpactChange }: {
  compact?: boolean; impactActive?: boolean; onImpactChange?: (active: boolean) => void;
}) {
  const { metric, setMetric } = useBetaPreferences();
  const { t } = useI18n();
  function select(metric: "value" | "return") {
    onImpactChange?.(false);
    setMetric(metric);
  }
  return <ChoiceGroup appearance={compact ? "segmented" : "underline"} label={t("히스토리 보기", "History view")}>
    <CairnButton variant="bare" type="button" aria-pressed={!impactActive && metric === "value"} onClick={() => select("value")}>{t("평가액", "Value")}</CairnButton>
    <CairnButton variant="bare" type="button" aria-pressed={!impactActive && metric === "return"} onClick={() => select("return")}>{t("수익률", "Return")}</CairnButton>
    {onImpactChange && <CairnButton variant="bare" type="button" aria-pressed={impactActive} onClick={() => onImpactChange(true)}>{t("가격·환율 영향", "Price & FX impact")}</CairnButton>}
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
