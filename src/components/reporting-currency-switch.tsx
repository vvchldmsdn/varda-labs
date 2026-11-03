"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import type { Currency } from "@/lib/money";
import { parseNativeViewDraft } from "@/lib/recovery-currency";
import { CairnSelect } from "@/components/presentation/cairn-select";
import { Status as CairnStatus } from "@/components/cairn-ui";


export const REPORTING_ROUTES = ["/", "/today", "/history", "/portfolio/structure", "/additional-contribution", "/investment-lab", "/simulation", "/portfolio/reporting"] as const;
export function reportingCurrencyHref(pathname: string, query: string, currency: Currency) {
  const next = new URLSearchParams(query);
  const view = ({ "/": "home", "/today": "today", "/history": "history", "/portfolio/structure": "structure", "/portfolio/reporting": "reporting" } as Record<string, string>)[pathname];
  if (view && next.getAll("scope").length <= 1 && next.getAll("currency").length <= 1) {
    const saved = parseNativeViewDraft(next.getAll("_nativeView"), next.get("scope") ?? "all", view, next.get("currency") === "USD" ? "USD" : "KRW");
    if (saved) next.set("_nativeView", JSON.stringify({ version: 1, scope: saved.scope, view, currency,
      ...(saved.selected ? { selected: saved.selected } : {}), ...(saved.zone ? { zone: saved.zone } : {}) }));
  }
  next.set("currency", currency);
  // The legacy amount query is specifically KRW. Never reinterpret it as USD.
  next.delete("amount");
  return `${pathname}?${next.toString()}`;
}

export function ReportingCurrencySwitch() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  return <div className="varda-reporting-control"><span>{t("분석 통화", "Analysis currency")}</span><CairnSelect className="cairn-currency-select" label={t("분석 통화", "Analysis currency")} value={params.get("currency") === "USD" ? "USD" : "KRW"} options={[{value:"KRW",label:"KRW"},{value:"USD",label:"USD"}]} disabled={pending} onValueChange={currency => { const href = reportingCurrencyHref(pathname, params.toString(), currency as Currency); startTransition(() => router.push(href, { scroll: false })); }} />{pending ? <CairnStatus as="span" tone="neutral" role="status">{t("계산 중", "Updating")}</CairnStatus> : null}</div>;
}
