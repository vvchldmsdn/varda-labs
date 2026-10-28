import 'server-only';
import {runTenantReadTransaction} from '@/db/tenant-transaction-context';
import type {DashboardData} from '@/lib/portfolio-dashboard';
import type {PortfolioAnalysisScope} from '@/lib/portfolio-analysis-scope';
import type {TenantContext} from '@/lib/session-resolver-contract';
import {buildPortfolioDashboardHoldingHistory} from './heatmap-model';
import {adaptHeatmap} from './heatmap-contract';
import {BETA_HEATMAP_ROWS_SQL} from './heatmap-read-sql';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function getBetaHeatmapRead({dashboard,scope,serviceDate,tenantContext}:{dashboard:DashboardData;scope:PortfolioAnalysisScope;serviceDate:string;tenantContext:TenantContext}){
 if(dashboard.selectedScope.key!==scope.key)throw new Error('Heatmap scope mismatch');
 const ids=[...new Set(dashboard.holdings.map(row=>row.id))];if(ids.some(id=>!uuid.test(id)))throw new Error('Invalid admitted holding identity');
 const [rows]=ids.length?await runTenantReadTransaction(tenantContext.ownerUserId,tx=>[tx.query(BETA_HEATMAP_ROWS_SQL,[ids,serviceDate,45*ids.length*3])]):[[]];
 const text=(v:unknown)=>typeof v==='string'?v:null;
 const currentDate=new Date(new Date(dashboard.generatedAt).getTime()+9*3600000).toISOString().slice(0,10);
 const history=buildPortfolioDashboardHoldingHistory({currentDate,holdings:dashboard.holdings.map(row=>({id:row.id,name:row.name,ticker:row.ticker,account:row.account,currentWeight:row.currentWeight,valueKrw:row.valueKrw,dailyChangeKrw:row.dailyChangeKrw,dailyReturnPct:row.dailyReturnPct,fxDailyChangeKrw:row.fxDailyChangeKrw})),rows:rows.map(row=>({snapshotDate:String(row.snapshot_date),assetId:text(row.asset_id),ticker:text(row.ticker),assetName:text(row.asset_name),account:text(row.account),unitValueChangePct:row.unit_value_change_pct,marketValueChangePct:row.market_value_change_pct,marketValueChangeKrw:row.market_value_change_krw,priceChangeKrw:row.price_change_krw,fxChangeKrw:row.fx_change_krw,marketValueKrw:row.market_value_krw,costKrw:row.cost_krw,pnlKrw:row.pnl_krw,source:text(row.source),cycleEndAt:text(row.cycle_end_at),capturedAt:text(row.captured_at),createdAt:text(row.created_at)}))});
 return adaptHeatmap(history,scope.key,currentDate);
}
