import { redirect } from "next/navigation";
import { readTradePhotoImportContext } from "@/db/queries/trade-photo-import-context";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { TradePhotoImport } from "@/components/trade-import/trade-photo-import";
import type { TradeImportContext } from "@/lib/trade-photo-import";
import styles from "@/components/trade-import/trade-photo-import.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "사진으로 거래 기록 | CAIRN LABS", robots: { index: false, follow: false } };
export default async function TradeImportPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const preview = process.env.NODE_ENV === "development" && (await searchParams).preview === "design";
  let initial: TradeImportContext;
  if (preview) {
    const accountId = "11111111-1111-4111-8111-111111111111";
    const symbols = ["VOO", "MSFT", "VXUS", "SCHD", "QQQ", "AMZN", "V", "TSM", "TMDX"];
    initial = { sessionKey: "a".repeat(64), serverNow: "2026-10-28T12:00:00Z", canWrite: true, complete: true, entries: [], accounts: [{ id: accountId, name: "예시 증권 계좌", active: true, state: { version: 1, accountId, startedAt: "2026-09-01T00:00:00Z", at: "2026-09-01T00:00:00Z", sequence: 0, cash: { USD: "0", KRW: "0" }, positions: [] }, assets: symbols.map((ticker, i) => ({ id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`, ticker, name: ticker, quantity: "10", currency: "USD", market: "us", assetType: "etf", archived: false })) }] };
  } else {
    const context = await readTradePhotoImportContext();
    if (!context) redirect("/auth/sign-in?returnTo=%2Fportfolio%2Ftrades%2Fimport");
    initial = context;
  }
  return <main className={styles.page}><SecondaryPageHeader /><TradePhotoImport initial={initial} preview={preview} /></main>;
}
