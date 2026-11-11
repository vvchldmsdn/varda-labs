"use client";

import { useSyncExternalStore } from "react";

const key = "cairn-theme";
const changed = "cairn-home-theme-change";
let fallback: boolean | null = null;

function readDark() {
  if (fallback !== null) return fallback;
  try { return window.localStorage.getItem(key) === "dark"; }
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

export function useHomeTheme() {
  const dark = useSyncExternalStore(subscribe, readDark, () => false);
  function toggle() {
    const next = !readDark();
    try { window.localStorage.setItem(key, next ? "dark" : "light"); fallback = null; }
    catch { fallback = next; }
    window.dispatchEvent(new Event(changed));
  }
  return { dark, toggle };
}
