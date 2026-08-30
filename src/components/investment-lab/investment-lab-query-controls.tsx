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
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
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
      scroll={false}
    />
  );
}
