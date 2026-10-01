"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import type { Currency } from "@/lib/money";
import { CairnSelect } from "@/components/presentation/cairn-select";

export const REPORTING_ROUTES = ["/", "/today", "/history", "/portfolio/structure", "/additional-contribution", "/investment-lab", "/simulation", "/portfolio/reporting"] as const;
export function reportingCurrencyHref(pathname: string, query: string, currency: Currency) {
  const next = new URLSearchParams(query);
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
  return <div className="varda-reporting-control"><span>{t("분석 통화", "Analysis currency")}</span><CairnSelect className="cairn-currency-select" label={t("분석 통화", "Analysis currency")} value={params.get("currency") === "USD" ? "USD" : "KRW"} options={[{value:"KRW",label:"KRW"},{value:"USD",label:"USD"}]} disabled={pending} onValueChange={currency => { const href = reportingCurrencyHref(pathname, params.toString(), currency as Currency); startTransition(() => router.push(href, { scroll: false })); }} />{pending ? <span role="status">{t("계산 중", "Updating")}</span> : null}</div>;
}
