"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import type { ReactNode } from "react";
import { labEnglish } from "./lab-copy";

/** An explicit product-text leaf; data and asset identity rendering stay untouched. */
export function LabText({ value }: { value: ReactNode }) {
  const { locale } = useI18n();
  return typeof value === "string" && locale === "en" ? labEnglish(value) : value;
}

export function useLabI18n() {
  const { locale } = useI18n();
  return { locale, l: (value: string) => locale === "en" ? labEnglish(value) : value };
}
