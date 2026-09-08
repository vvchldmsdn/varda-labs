"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { localeCookie, translate, type Locale } from "@/lib/i18n/locale";

type I18nContext = { locale: Locale; setLocale: (locale: Locale) => void; t: (ko: string, en?: string) => string };
const LocaleContext = createContext<I18nContext>({locale: "ko", setLocale: () => {}, t: ko => ko});

export function LocaleProvider({initialLocale, children}: {initialLocale: Locale; children: ReactNode}) {
  const [locale, setLanguage] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    if (next !== "ko" && next !== "en") return;
    // A display preference only. No navigation, data request, or form remount.
    document.cookie = localeCookie(next, window.location.protocol === "https:");
    setLanguage(next);
  }, []);
  const t = useCallback((ko: string, en?: string) => translate(locale, ko, en), [locale]);
  const value = useMemo(() => ({locale, setLocale, t}), [locale, setLocale, t]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <LocaleContext value={value}>{children}</LocaleContext>;
}

export const useI18n = () => useContext(LocaleContext);

