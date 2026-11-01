import { redirect } from "next/navigation";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { NativeLedgerView } from "@/components/native-ledger-view";
import { normalizeTradeRecordHint, tradeRecordHref } from "@/lib/trade-record-intent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trade records | CAIRN LABS", robots: { index: false, follow: false } };
export default async function NativeLedgerPage({ searchParams }: { searchParams: Promise<{ accountId?: string | string[]; assetId?: string | string[]; action?: string | string[]; currency?: string | string[] }> }) {
  const params = await searchParams;
  const initialSelection = normalizeTradeRecordHint(params);
  const reportingCurrency = params.currency === "USD" ? "USD" : "KRW";
  const href = tradeRecordHref(initialSelection);
  const returnTo = href + (href.includes("?") ? "&" : "?") + "currency=" + reportingCurrency;
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) redirect("/auth/sign-in?returnTo=" + encodeURIComponent(returnTo));
  return <NativeLedgerView key={returnTo} initialSelection={initialSelection} reportingCurrency={reportingCurrency} />;
}
