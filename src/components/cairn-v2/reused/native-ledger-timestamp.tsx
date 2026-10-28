"use client";
import { Field as CairnField, Input as CairnInput } from "@/components/cairn-ui";

import { useI18n } from "./native-locale";
import { updateNativeLedgerLocalMinute } from "../../../lib/native-ledger-clock";

/** Editing the date/minute never truncates the retained event seconds/milliseconds. */
export function NativeLedgerTimestamp({ label, name, value, onChange }: { label:string; name:string; value:string; onChange:(value:string)=>void }) {
  const { t } = useI18n();
  return <div className="cairn-timestamp"><span>{label}</span><div>
    <CairnField><span className="sr-only">{t("기록 날짜", "Record date")}</span><CairnInput type="date" value={value.slice(0,10)} required onChange={event=>onChange(updateNativeLedgerLocalMinute(value, `${event.target.value}T${value.slice(11,16)}`))} /></CairnField>
    <CairnField><span className="sr-only">{t("기록 시간", "Record time")}</span><CairnInput type="time" value={value.slice(11,16)} step="60" required onChange={event=>onChange(updateNativeLedgerLocalMinute(value, `${value.slice(0,10)}T${event.target.value}`))} /></CairnField>
  </div><details className="cairn-details"><summary>{t("초 단위 시각 확인·수정", "Review or edit exact time")}</summary><CairnField>{t("정확한 기록 시각", "Exact recorded time")}<CairnInput name={name} type="datetime-local" step="0.001" value={value} required onChange={event=>onChange(event.target.value)} /></CairnField></details></div>;
}
