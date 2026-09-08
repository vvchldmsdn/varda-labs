"use client";

import { createElement } from "react";

import { useI18n } from "./locale-provider";

/** A reactive text leaf: its parent can continue rendering and reading data on the server. */
export function T({ko, en}: {ko: string; en: string}) {
  const {t} = useI18n();
  return t(ko, en);
}

/** Keep native SVG title children as strings for consistent React SSR and hydration. */
export function LocalizedSvgText({as, ko, en, id}: {as: "title" | "desc"; ko: string; en: string; id?: string}) {
  const {t} = useI18n();
  return createElement(as, {id}, t(ko, en));
}
