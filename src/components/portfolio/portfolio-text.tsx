"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { portfolioEnglish } from "./portfolio-copy";

/** Reactive text leaf for system-owned portfolio labels returned by server views. */
export function PortfolioText({ ko, en }: { ko: string | number | null | undefined; en?: string }) {
  const { locale, t } = useI18n();
  return ko == null ? null : typeof ko === "number" ? ko : <>{locale === "ko" ? ko : t(ko, en ?? portfolioEnglish(ko))}</>;
}

export function usePortfolioText() {
  const { locale, t } = useI18n();
  return (ko: string, en?: string) => locale === "ko" ? ko : t(ko, en ?? portfolioEnglish(ko));
}
