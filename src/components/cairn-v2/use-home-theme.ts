"use client";

import { useSyncExternalStore } from "react";

function booleanPreference(key: string, enabled: string, disabled: string) {
  let fallback: boolean | null = null;
  const changed = key + "-change";
  function read() {
    if (fallback !== null) return fallback;
    try { return window.localStorage.getItem(key) === enabled; }
    catch { return false; }
  }
  function subscribe(notify: () => void) {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) notify();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(changed, notify);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(changed, notify);
    };
  }
  function set(value: boolean) {
    try { window.localStorage.setItem(key, value ? enabled : disabled); fallback = null; }
    catch { fallback = value; }
    window.dispatchEvent(new Event(changed));
  }
  return { read, subscribe, set };
}

const theme = booleanPreference("cairn-theme", "dark", "light");
const motion = booleanPreference("cairn-reduce-effects", "reduced", "standard");
const serverDefault = () => false;

export function useReducedEffects() {
  const reduced = useSyncExternalStore(motion.subscribe, motion.read, serverDefault);
  return [reduced, motion.set] as const;
}

export function useHomeTheme() {
  const dark = useSyncExternalStore(theme.subscribe, theme.read, serverDefault);
  return {
    dark,
    toggle: () => theme.set(!theme.read()),
  };
}
