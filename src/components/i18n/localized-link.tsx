"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useI18n } from "./locale-provider";

export function LocalizedLink({en, ...props}: ComponentProps<typeof Link> & {en?: {title?: string; "aria-label"?: string}}) {
  const {locale} = useI18n();
  return <Link {...props} {...(locale === "en" ? en : {})} />;
}
