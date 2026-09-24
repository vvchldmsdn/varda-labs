import { redirect } from "next/navigation";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { NativeLedgerView } from "@/components/native-ledger-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holdings & cash | CAIRN LABS", robots: { index: false, follow: false } };
export default async function NativeLedgerPage({ searchParams }: { searchParams: Promise<{ accountId?: string; assetId?: string; action?: string }> }) {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) redirect("/auth/sign-in?returnTo=%2Fportfolio%2Fledger");
  const params = await searchParams;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return <NativeLedgerView initialSelection={{ accountId: typeof params.accountId === "string" && uuid.test(params.accountId) ? params.accountId : undefined, assetId: typeof params.assetId === "string" && uuid.test(params.assetId) ? params.assetId : undefined, action: ["buy", "sell", "cost_basis"].includes(params.action ?? "") ? params.action : undefined }} />;
}
