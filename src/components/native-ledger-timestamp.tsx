"use client";
import { useI18n } from "@/components/i18n/locale-provider";
import { updateNativeLedgerLocalMinute } from "@/lib/native-ledger-clock";

/** Editing the date/minute never truncates the retained event seconds/milliseconds. */
export function NativeLedgerTimestamp({ label, name, value, onChange }: { label:string; name:string; value:string; onChange:(value:string)=>void }) {
  const { t } = useI18n();
  return <div className="cairn-timestamp"><span>{label}</span><div>
    <label><span className="sr-only">{t("기록 날짜", "Record date")}</span><input type="date" value={value.slice(0,10)} required onChange={event=>onChange(updateNativeLedgerLocalMinute(value, `${event.target.value}T${value.slice(11,16)}`))} /></label>
    <label><span className="sr-only">{t("기록 시간", "Record time")}</span><input type="time" value={value.slice(11,16)} step="60" required onChange={event=>onChange(updateNativeLedgerLocalMinute(value, `${value.slice(0,10)}T${event.target.value}`))} /></label>
  </div><details className="cairn-details"><summary>{t("초 단위 시각 확인·수정", "Review or edit exact time")}</summary><label>{t("정확한 기록 시각", "Exact recorded time")}<input name={name} type="datetime-local" step="0.001" value={value} required onChange={event=>onChange(event.target.value)} /></label></details></div>;
}
