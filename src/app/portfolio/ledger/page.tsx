import { redirect } from "next/navigation";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { NativeLedgerView } from "@/components/native-ledger-view";
import { normalizeTradeRecordHint, tradeRecordHref } from "@/lib/trade-record-intent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trade records | CAIRN LABS", robots: { index: false, follow: false } };
export default async function NativeLedgerPage({ searchParams }: { searchParams: Promise<{ accountId?: string | string[]; assetId?: string | string[]; action?: string | string[] }> }) {
  const initialSelection = normalizeTradeRecordHint(await searchParams);
  const returnTo = tradeRecordHref(initialSelection);
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) redirect("/auth/sign-in?returnTo=" + encodeURIComponent(returnTo));
  return <NativeLedgerView key={returnTo} initialSelection={initialSelection} />;
}
