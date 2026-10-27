"use client";

import { Languages } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useI18n } from "./locale-provider";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function LanguageSwitch() {
  const {locale, setLocale, t} = useI18n();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  return <button type="button" disabled={!ready} className="varda-language-switch" aria-label={t("Switch to English", "한국어로 전환")}
    title={t("영어로 보기", "Switch to Korean")} onClick={() => setLocale(locale === "ko" ? "en" : "ko")}>
    <Languages size={16} aria-hidden="true" />
    <span lang={locale === "ko" ? "en" : "ko"}>{locale === "ko" ? "EN" : "한국어"}</span>
  </button>;
}
