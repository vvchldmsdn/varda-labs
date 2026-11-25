import "server-only";
import { readNativeSaleLedger } from "@/db/queries/native-portfolio-ledger";
import { readRecordedSaleFx } from "@/db/queries/native-recorded-sale-fx";
import { readBrokerRealizedStatements } from "@/db/queries/broker-realized-statements";
import { loadTenantPortfolioGroupMemberships } from "@/db/queries/tenant-group-reads";
import { resolveNativeGroupSelection } from "../native-group-scope";
import { projectNativeRecordedSales } from "../native-recorded-sales";
import { recordedHistoricalFx, valueRecordedSales } from "../currency-tracked-portfolio";
import type { Currency } from "../money";
import type { TenantContext } from "../session-resolver-contract";
import type { PortfolioAnalysisScope } from "../portfolio-analysis-scope";
import { summarizeRecordedSales, type BetaRealizedProfit } from "./realized-profit";

export async function readRecordedLedgerProfit(tenant:TenantContext, scope:PortfolioAnalysisScope, asOf:string) {
  const [ledger, memberships] = await Promise.all([
    readNativeSaleLedger(tenant,scope.kind==="account" ? scope.accountId : undefined),
    scope.kind==="portfolio_group"
      ? loadTenantPortfolioGroupMemberships({mode:"all",portfolioGroupId:scope.portfolioGroupId,tenantContext:tenant}) : null,
  ]);
  const selection = memberships && resolveNativeGroupSelection(memberships,asOf);
  const sales = projectNativeRecordedSales(tenant.ownerUserId,asOf,ledger,scope.kind,selection ?? undefined);
  const dates = await readRecordedSaleFx(sales.realizedTrades ?? [],asOf);
  const includedAccounts = new Set(ledger.accounts.filter(a=>!selection || selection.wholeAccountIds.includes(a.id) ||
    a.assets.some(h=>selection.directAssetIds.includes(h.id))).map(a=>a.id));
  const captures = ledger.captures.filter(row=>includedAccounts.has(row.accountId) && Date.parse(row.at)<Date.parse(asOf) &&
    (!selection || Date.parse(row.at)>=Date.parse(selection.stableSince)));
  function report(reporting:Currency) {
    const captured = captures.filter(row=>!row.currencies || row.currencies.includes(reporting))
      .flatMap(row=>row.fx.map(fx=>({...fx,capturedAt:row.capturedAt ?? row.at})));
    return summarizeRecordedSales(valueRecordedSales({ownerId:tenant.ownerUserId,...sales,reporting,asOf,maxFxAgeMs:3*86_400_000},
      recordedHistoricalFx([...dates,...captured],asOf)));
  }
  return {KRW:report("KRW"),USD:report("USD")};
}

export async function readBetaRealizedProfit(tenant:TenantContext, scope:PortfolioAnalysisScope, now=new Date()):Promise<BetaRealizedProfit> {
  const [ledger,broker] = await Promise.allSettled([
    readRecordedLedgerProfit(tenant,scope,now.toISOString()),readBrokerRealizedStatements(tenant,scope),
  ]);
  if (ledger.status==="rejected" && broker.status==="rejected") throw new Error("realized_profit_unavailable");
  return {scope:scope.key,ledger:ledger.status==="fulfilled" ? ledger.value : null,broker:broker.status==="fulfilled" ? broker.value : null};
}
