"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { simulationEnglish } from "./simulation-copy";

/** Reactive text leaf for system-owned simulation labels returned by server views. */
export function SimulationText({ ko, en }: { ko: string | number | null | undefined; en?: string }) {
  const { locale, t } = useI18n();
  return ko == null ? null : typeof ko === "number" ? ko : <>{locale === "ko" ? ko : t(ko, en ?? simulationEnglish(ko))}</>;
}

export function useSimulationText() {
  const { locale, t } = useI18n();
  return (ko: string, en?: string) => locale === "ko" ? ko : t(ko, en ?? simulationEnglish(ko));
}
