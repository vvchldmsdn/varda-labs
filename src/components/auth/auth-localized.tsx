"use client";

import { createElement, type JSX, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { translateAuthCopy } from "./auth-copy";

export function AuthText({children}: {children: ReactNode}) {
  const {locale} = useI18n();
  return typeof children === "string" && locale === "en" ? translateAuthCopy(children) : children;
}

export function AuthElement<Tag extends keyof JSX.IntrinsicElements>({as,...props}: JSX.IntrinsicElements[Tag] & {as: Tag}) {
  const {locale} = useI18n();
  const attributes: Record<string, unknown> = {...props};
  if (locale === "en") for (const key of ["aria-label", "title", "placeholder", "alt"]) {
    if (typeof attributes[key] === "string") attributes[key] = translateAuthCopy(attributes[key]);
  }
  return createElement(as, attributes);
}
