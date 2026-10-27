"use client";

import { createElement, type JSX } from "react";
import { useI18n } from "./locale-provider";

type TranslatedAttribute = "aria-label" | "aria-description" | "aria-valuetext" | "title" | "placeholder" | "alt";
type Props<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & {
  as: Tag;
  en?: Partial<Record<TranslatedAttribute, string>>;
};

/** Native accessible attributes can react to locale while children stay server-rendered. */
export function LocalizedElement<Tag extends keyof JSX.IntrinsicElements>({as, en, ...props}: Props<Tag>) {
  const {locale} = useI18n();
  return createElement(as, {...props, ...(locale === "en" ? en : {})});
}
