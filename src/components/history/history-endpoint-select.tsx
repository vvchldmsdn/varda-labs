"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { CairnSelect } from "@/components/presentation/cairn-select";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { historySourceLabel } from "./history-format";
import type { HistoryPositionComparisonModel } from "@/lib/history-position-comparison";

export function HistoryEndpointSelect({ label, name, options, defaultValue, disabled }: {
  label: string;
  name: "comparisonFrom" | "comparisonTo";
  options: HistoryPositionComparisonModel["options"];
  defaultValue: string | null;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(defaultValue ?? "");
  const text = t(label, translateHomeHistory(label));
  return <div className="grid min-w-0 gap-1 text-xs text-[var(--muted)]">
    <span>{text}</span>
    <input type="hidden" name={name} value={value} disabled={disabled} />
    <CairnSelect label={text} value={value} onValueChange={setValue} disabled={disabled}
      options={options.length ? options.map(option => ({ value: option.token, label: `${option.snapshotDate} · ${t(historySourceLabel(option.source), translateHomeHistory(historySourceLabel(option.source)))}` })) : [{ value: "", label: t("저장점 없음", "No snapshot") }]} />
  </div>;
}
