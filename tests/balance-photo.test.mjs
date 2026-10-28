import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceQuantity, parseBalancePhoto } from '../src/lib/balance-photo.ts';
import { parseHoldingOnboardingInput } from '../src/lib/holding-onboarding.ts';
const line = (text, x, y, w = 110, h = 25) => ({text, confidence:95, bbox:{x0:x,y0:y,x1:x+w,y1:y+h}});
test('fractional quantity preserves six decimals and rejects guessed numeric substitutions',()=>{
 assert.equal(balanceQuantity('1,234.010709주'),'1234.010709');
 for(const value of ['1,23','0','-1','O.10709','1e4','3%','1.1234567','=1+2']) assert.equal(balanceQuantity(value),null);
});
test('holdings column chooses holdings below saleable and never valuation or cost',()=>{
 const result=parseBalancePhoto([line('보유 수량',800,300),line('VOO',60,440),line('1',825,420,40),line('6.525621',790,480),line('491,250',600,420),line('499,858',600,480)],1000,2000);
 assert.equal(result.state,'review'); assert.deepEqual(result.rows.map(r=>[r.label,r.quantity]),[['VOO','6.525621']]);
});
test('trade screenshots and unlabeled numeric columns cannot create holdings',()=>{
 assert.equal(parseBalancePhoto([line('주문 내역',0,0),line('체결 수량',0,100)],1000,2000).state,'not_balance');
 assert.equal(parseBalancePhoto([line('VOO',60,440),line('6',800,440)],1000,2000).state,'layout_unknown');
});
test('a missing row quantity never borrows the following holding quantity',()=>{
 const result=parseBalancePhoto([line('보유수량',800,300),line('VOO',60,440),line('VXUS',60,680),line('26',825,720,40)],1000,2000);
 assert.equal(result.rows[0].quantity,''); assert.equal(result.rows[1].quantity,'26');
});
test('overlapping rows stay separate for explicit duplicate review',()=>{
 const result=parseBalancePhoto([line('보유수량',800,300),line('VOO',60,440),line('6',825,480,40),line('VOO',60,680),line('6',825,720,40)],1000,2000);
 assert.equal(result.rows.length,2); assert.equal(result.rows[0].quantity,'6');
});
test('a reviewed photo quantity reaches onboarding without invented cost or valuation',()=>{
 const data=new FormData();
 for(const [key,value] of Object.entries({accountId:'11111111-1111-4111-8111-111111111111',market:'us',assetType:'etf',ticker:'VOO',name:'Vanguard S&P 500 ETF',quantity:balanceQuantity('6.525621주'),averageCost:'',currentPrice:''})) data.set(key,value);
 const result=parseHoldingOnboardingInput(data);
 assert.equal(result.ok,true);
 assert.equal(result.input.quantity,'6.525621');
 assert.equal(result.input.averageCost,null);
 assert.equal(result.input.currentPrice,null);
 assert.equal(result.input.reportedReturnPct,null);
 assert.equal(result.input.currency,'USD');
});
