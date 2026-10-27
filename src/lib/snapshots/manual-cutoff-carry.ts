import { Decimal } from '../money.ts';
/** A stored manual state may carry forward; it is never a market observation. */
export function resolveStoredManualCutoffCarry(asset: {id:string;currency:string|null;canonicalOwnerUserId:string|null;accountId:string|null;ticker:string|null;quantity:string|null;currentPrice:string|null;fractionalKrwValue:string|null;updatedAt:Date|string|null;priceAsOf:Date|string|null}, row: {id:string;currency:string|null;assetId:string|null;canonicalOwnerUserId:string|null;accountId:string|null;snapshotDate:string;capturedAt:Date|string|null;source:string|null;priceBasis:string|null;priceSource:string|null;quantity:string|null;currentPrice:string|null;marketValueKrw:string|null;referenceDate:string|null;priceDate:string|null;isSample:boolean}, snapshotDate:string, cutoff:Date){
 if(asset.currency!=="KRW"||row.currency!=="KRW"||asset.ticker||asset.priceAsOf||row.isSample||row.assetId!==asset.id||row.accountId!==asset.accountId||row.canonicalOwnerUserId!==asset.canonicalOwnerUserId||row.snapshotDate>=snapshotDate)return null;
 const captured=new Date(row.capturedAt??'').getTime(),updated=new Date(asset.updatedAt??'').getTime();
 if(!Number.isFinite(captured)||!Number.isFinite(updated)||captured>=cutoff.getTime()||updated>captured)return null;
 const q=Decimal.from(asset.quantity??'0');if(q.compare(0)<=0||q.compare(row.quantity??'0')!==0||Decimal.from(asset.fractionalKrwValue??'0').compare(0)!==0)return null;
 const confirmed=row.source?.startsWith('broker_reconstructed_close_v1:')&&row.priceBasis==='confirmed_manual_total'&&row.priceSource==='user_confirmed_total_valuation';
 const stored=row.source==='varda_manual_daily_snapshot'&&row.priceBasis==='manual_current'&&['asset_current_price','manual_entry'].includes(row.priceSource??'');
 if(!confirmed&&!stored)return null;
 const price=confirmed?Decimal.from(row.marketValueKrw??'0').div(q):Decimal.from(row.currentPrice??'0');
 if(price.compare(0)<=0||(!confirmed&&price.compare(asset.currentPrice??'0')!==0))return null;
 const referenceDate=row.referenceDate??row.priceDate??row.snapshotDate;if(referenceDate>row.snapshotDate)return null;
 return {price:Number(price.toExactString()),source:confirmed?'manual_entry':row.priceSource!,referenceDate,manualCarryCapturedAt:new Date(captured).toISOString(),manualCarrySnapshotId:row.id};
}
