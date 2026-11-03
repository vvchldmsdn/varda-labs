// Synthetic presentation evidence only. Never used by production queries.
export function betaVisualFixture(base, blank) {
  const rows = base.rows.map((row,index) => ({...row, market:index===2?'korea':'us', name:index===2?'KODEX 200':row.name, ticker:index===2?'069500':row.key, currency:'USD', quantity:0.896567, currentPrice:701.26}));
  const movements = rows.map((row,index) => ({key:row.key,name:row.name,ticker:row.ticker,account:'QA',accountLabel:'QA account',market:row.market,currency:row.currency,changeKrw:index===2?-4500:8000-index*750,returnPct:index===2?-0.5:0.04,previousValueKrw:row.valueKrw,tradeFlowKrw:0,source:'daily_position_snapshot',identityStatus:'matched'}));
  const dates = Array.from({length:31},(_,index)=>new Date(Date.UTC(2026,8,3+index)).toISOString().slice(0,10));
  const heatmapRows = rows.map((row,index)=>({holdingId:row.key,name:row.name,ticker:row.ticker,market:row.market,account:'QA',currentWeight:row.weightPct,cells:dates.map((date,day)=>({date,changePct:index===0&&day===2?null:((day+index)%7-3)/2,marketValueKrw:index===0&&day===2?null:row.valueKrw,changeKrw:null,priceChangeKrw:null,fxChangeKrw:null,basis:index===0&&day===2?'missing':'unit_value'}))}));
  return {...base,rows,domain:{...blank.domain,state:'ready',valueState:'ready',historyState:'ready',movementState:'partial',knownSubtotalKrw:base.totalKrw,
    heatmap:{state:'partial',scopeKey:'all',currencyBasis:'KRW',currentDate:dates.at(-1),message:'합성 검증 자료 · 누락 1칸',history:{dates,rows:heatmapRows,observedCellCount:rows.length*31-1,expectedCellCount:rows.length*31,coveragePct:(rows.length*31-1)/(rows.length*31)*100}},
    historyDisplayCurrency:'KRW',comparisonDate:'2026-10-01',refreshedAt:'2026-10-03T02:00:00Z',
    scopes:[{key:'all',label:'QA portfolio',detail:'Synthetic presentation'}],
    moneyBasis:{structure:{usdKrwRate:1400,rateDate:null},dashboard:{usdKrwRate:1400,rateDate:'2026-10-02'}},
    currentHoldingMovement:{basis:'current_quantity_price_fx',changeKrw:32000,returnPct:0.04,previousValueKrw:base.totalKrw,includedCount:rows.length,excludedCount:1,partial:true,valuationChangeKrw:null,quantityChangeKrw:null,rows:movements,exclusions:[]},
    investmentReturn:{basis:'investment_assets_excluding_cash',currency:'KRW',costKrw:null,pnlKrw:null,returnPct:null,reason:'missing_cost_evidence',coverage:{confirmed:1,total:rows.length,knownCostKrw:1000000,knownPnlKrw:-10000,knownReturnPct:-1}},
  }};
}
export const returnVisualFixture = {
  stored:[{date:'2026-09-28',returnPct:3,segment:'stored'},{date:'2026-09-29',returnPct:4,segment:'stored'}],
  curve:{baseDate:'2026-09-30',endDate:'2026-10-04',currency:'KRW',revision:1,missingDays:1,points:[
    {date:'2026-09-30',valueKrw:1000,returnPct:0},
    {date:'2026-10-01',valueKrw:1100,returnPct:10},
    {date:'2026-10-02',valueKrw:null,returnPct:null},
    {date:'2026-10-03',valueKrw:1050,returnPct:5},
    {date:'2026-10-04',valueKrw:1080,returnPct:8},
  ]},
};
