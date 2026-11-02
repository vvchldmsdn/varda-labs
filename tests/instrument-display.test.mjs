import assert from 'node:assert/strict';
import {it} from 'node:test';
import {instrumentLabel} from '../src/lib/instrument-display.ts';
it('uses the explicit listing market without changing stored identity or amounts',()=>{
 const rows=[
  {market:'korea',ticker:'069500',name:'KODEX 200',currency:'USD'},
  {market:'KRX',ticker:'379800',name:'KODEX 미국S&P500',currency:'KRW'},
  {market:'us',ticker:'TSM',name:'Taiwan Semiconductor ADR',currency:'KRW'},
  {market:'US',ticker:'MSFT',name:'Microsoft',currency:'USD'},
  {market:null,ticker:'VOO',name:'Historical name'},
  {market:'us',ticker:null,name:'Missing ticker'},
 ];
 const before=structuredClone(rows);
 assert.deepEqual(rows.map(instrumentLabel),['KODEX 200','KODEX 미국S&P500','TSM','MSFT','Historical name','Missing ticker']);
 assert.deepEqual(rows,before);assert.equal(instrumentLabel({name:'  ',ticker:'069500'}),'069500');
});
