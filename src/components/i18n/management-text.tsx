"use client";
import {createElement,type JSX,type ReactNode} from "react";
import {useI18n} from "./locale-provider";
import {translateManagementCopy} from "@/lib/i18n/management-copy";

export function ManagementText({children}: {children:ReactNode}) {
  const {locale}=useI18n();
  return typeof children === "string" && locale === "en" ? translateManagementCopy(children) : children;
}
export function ManagementElement<Tag extends keyof JSX.IntrinsicElements>({as,...props}: JSX.IntrinsicElements[Tag] & {as:Tag}) {
  const {locale}=useI18n();
  const attributes:Record<string,unknown>={...props};
  if(locale === "en") for(const key of ["aria-label","title","placeholder","alt"]) {
    if(typeof attributes[key] === "string") attributes[key]=translateManagementCopy(attributes[key]);
  }
  return createElement(as,attributes);
}
