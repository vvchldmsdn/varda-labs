"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

const PRESENTATION_PARAMS = ["view", "preview"] as const;

export function InvestmentLabQueryFields() {
  const params = useSearchParams();
  return PRESENTATION_PARAMS.map((name) => {
    const value = params.get(name);
    return value ? (
      <input key={name} name={name} type="hidden" value={value} />
    ) : null;
  });
}

export function InvestmentLabQueryLink({
  href,
  onClick,
  resetForm = false,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  resetForm?: boolean;
}) {
  const params = useSearchParams();
  const target = new URL(href, "https://varda.local");
  for (const name of PRESENTATION_PARAMS) {
    const value = params.get(name);
    if (value && !target.searchParams.has(name))
      target.searchParams.set(name, value);
  }
  return (
    <Link
      {...props}
      href={`${target.pathname}${target.search}${target.hash}`}
      onClick={(event) => {
        onClick?.(event);
        // Also reset dirty fields when the latest-period URL is already active.
        if (
          resetForm &&
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
        ) {
          event.currentTarget.closest("form")?.reset();
        }
      }}
      scroll={false}
    />
  );
}
