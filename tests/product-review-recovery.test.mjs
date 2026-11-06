import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePlanEditor,PLAN_EDITOR_KEY} from '../src/lib/investment-plan-editor.ts';
import {PLAN_TTL_MS} from '../src/lib/investment-plan.ts';
import {readPhotoDraft,savePhotoDraft,photoDraftKey} from '../src/lib/trade-photo-draft.ts';
import {isCollectionPriceSource} from '../src/lib/quote-time-basis.ts';
import {compositionPriceTime} from '../src/lib/current-investment-composition.ts';
import {originalCurrentComposition} from '../src/lib/cairn-v2/current-value-presentation.ts';

const owner='a'.repeat(64),other='b'.repeat(64),now=Date.now();
const editor={version:1,expiresAt:now+PLAN_TTL_MS,calculationId:null,quickId:null,currency:'USD',amount:'1.',rows:[{name:'ETF',value:'0.896567',target:'-'}],asOf:new Date(now).toISOString(),versioned:true,calculated:false};
test('unfinished editor strings survive without becoming calculated monetary values; expiry and bounds apply',()=>{
  assert.equal(PLAN_EDITOR_KEY,'cairn.plan-editor.v1');
  const restored=parsePlanEditor(JSON.stringify(editor),now);
  assert.deepEqual(restored,editor);assert.equal(restored.calculated,false);
  assert.equal(parsePlanEditor(JSON.stringify(editor),now+PLAN_TTL_MS),null);
  assert.equal(parsePlanEditor(JSON.stringify({...editor,currency:'EUR'}),now),null);
  assert.equal(parsePlanEditor(JSON.stringify({...editor,rows:Array(13).fill(editor.rows[0])}),now),null);
});
function storage(){const values=new Map();return {values,get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}}
const row={key:'review-one',operationId:'11111111-1111-4111-8111-111111111111',accountId:'account',assetId:'holding',afterEventId:'',label:'VOO',side:'buy',date:'2026-10-26',quantity:'0.896567',price:'700.12',currency:'USD',gross:'',priceSource:'reported',verified:true,status:'review'};
test('photo review drafts preserve stable operations/partial success while excluding image and OCR bytes',()=>{
  const store=storage();assert.equal(savePhotoDraft(store,owner,[{...row,photo:'blob:private',rawText:'PII',status:'saved'}],row.key,now),true);
  const raw=store.getItem(photoDraftKey(owner));assert.doesNotMatch(raw,/blob:|PII|rawText|photo"/);
  assert.deepEqual(readPhotoDraft(store,owner,now),{active:row.key,rows:[{...row,status:'saved'}]});
  assert.equal(readPhotoDraft(store,other,now),null);
  assert.equal(readPhotoDraft(store,owner,now+86400000),null);assert.equal(store.length,0);
  assert.equal(savePhotoDraft({setItem(){throw Error('disabled')}},owner,[row],row.key,now),false);
});
test('known KIS receipt times are labeled as collection without changing values or other provider timestamps',()=>{
  for(const source of ['kis','kis_domestic_inquire_price','kis_overseas_price:NAS'])assert.equal(isCollectionPriceSource(source),true);
  for(const source of ['twelve_data','user_entered_onboarding','kis_domestic_itemchartprice',null])assert.equal(isCollectionPriceSource(source),false);
  const asOf='2026-10-26T01:00:00Z';
  const data={generatedAt:asOf,totalValueKrw:100,usdKrwRate:1400,holdings:[{name:'ETF',ticker:'ETF',account:'A',market:'korea',currency:'KRW',quantity:1,currentPrice:100,currentWeight:100,valueKrw:100,priceAsOf:asOf,priceFetchedAt:asOf,priceSource:'kis_domestic_inquire_price'}]};
  const composition=originalCurrentComposition({kind:'legacy',data},'KRW');
  assert.equal(composition.amount,'100');assert.deepEqual(compositionPriceTime(composition.positions[0]),{label:'시세 수집 시각',value:asOf});
  assert.deepEqual(compositionPriceTime({priceTimestampBasis:'daily_close',priceReferenceDate:'2026-10-25'}),{label:'종가 기준일',value:'2026-10-25'});
});
