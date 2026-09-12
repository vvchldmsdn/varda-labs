"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { parseDraft, PLAN_STORAGE_KEY } from "@/lib/investment-plan";

function readPlanReference() {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY);
    return parseDraft(raw) ? raw : null;
  } catch { return null; }
}
function subscribeToPlanReference(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    try {
      const restored = parseDraft(localStorage.getItem(PLAN_STORAGE_KEY));
      if (restored) timer = setTimeout(refresh, Math.max(0, restored.expiresAt - Date.now()));
      else localStorage.removeItem(PLAN_STORAGE_KEY);
    } catch { /* Holding entry remains available without browser storage. */ }
    onChange();
  };
  refresh();
  const onStorage = (event: StorageEvent) => { if (event.key === PLAN_STORAGE_KEY || event.key === null) refresh(); };
  window.addEventListener("storage", onStorage);
  return () => { clearTimeout(timer); window.removeEventListener("storage", onStorage); };
}
const noServerDraft = () => null;

export function PlanHoldingReference({ disabled, onSearch }: { disabled: boolean; onSearch: (name: string) => void }) {
  const { t } = useI18n();
  const raw = useSyncExternalStore(subscribeToPlanReference, readPlanReference, noServerDraft);
  const draft = parseDraft(raw);
  if (!draft) return <p className="varda-onboarding-hint">{t("계획의 임시 입력을 찾지 못했습니다. 저장한 계획에서 다시 이어올 수 있어요.", "The temporary plan input is unavailable. Continue again from your saved plans.")} <Link className="varda-onboarding-text-button" href="/plans">{t("내 계획", "My plans")}</Link></p>;
  return <section className="varda-onboarding-disclosure" aria-label={t("계획에서 이어서 등록", "Continue from your plan")}>
    <p className="varda-onboarding-eyebrow">{t("계획에서 이어서 등록", "CONTINUE FROM YOUR PLAN")}</p>
    <p className="varda-onboarding-hint">{t("이름을 누르면 종목을 검색해요. 실제 종목을 확인하고 보유 수량만 추가하세요. 계획의 평가금액과 목표는 참고용이며 실제 보유자산으로 자동 저장하지 않습니다.", "Select a name to search, verify the actual instrument, then enter your quantity. Plan values and targets are references and are never saved as actual holdings automatically.")}</p>
    <ul>{draft.input.rows.map((row, index) => <li key={index}>
      <button type="button" className="varda-onboarding-text-button" disabled={disabled} onClick={() => onSearch(row.name)}>{row.name} ↗</button>
      <span className="varda-onboarding-hint"> · {row.value.toLocaleString()} KRW · {t("목표", "Target")} {row.targetBps / 100}%</span>
    </li>)}</ul>
    <p className="varda-onboarding-hint">{t("수량을 등록하면 실제 보유종목의 가격 흐름을 볼 수 있어요. 매입가는 나중에 입력해도 됩니다.", "Adding quantities lets you follow your actual holdings. Purchase costs can be added later.")}</p>
    <Link className="varda-onboarding-text-button" href="/plans">{t("나중에 등록하고 내 계획으로", "Add holdings later and return to my plans")}</Link>
  </section>;
}
