import assert from 'node:assert/strict';
import { it } from 'node:test';
import { importWithPorts } from './helpers/import-with-ports.mjs';

it('KIS live and FX use response completion, never pre-cutoff batch start as observation time', async t => {
  const previous={key:process.env.KIS_APP_KEY,secret:process.env.KIS_APP_SECRET};
  process.env.KIS_APP_KEY='synthetic-only';process.env.KIS_APP_SECRET='synthetic-only';
  const request=new Date('2026-09-24T21:59:00Z'),receipt=new Date('2026-09-24T22:01:00Z');
  t.mock.timers.enable({apis:['Date'],now:request});
  try {
    const [kis]=await importWithPorts(['src/lib/market-data/providers/kis.ts'],{
      './kis-token-lifecycle':{getReusableKisAccessToken:async()=> 'synthetic-only'},
      '@/lib/market-data/provider-budget':{fetchKisWithBudget:async(_config,url)=>{
        t.mock.timers.setTime(receipt.getTime());
        return Response.json(url.includes('price-detail')?{rt_cd:'0',output:{curr:'USD',t_rate:'1300'}}:{rt_cd:'0',output:{last:'105'}});
      }},
    });
    const result=await kis.createKisMarketDataProvider().fetchLiveQuotes([{ticker:'UNIT',market:'us',currency:'USD',assetIds:[]}],{requestedAt:request,mode:'live',dryRun:false,fixture:false});
    assert.equal(result.rows[0].status,'ok',result.rows[0].error);assert.equal(result.rows[0].fetchedAt.toISOString(),receipt.toISOString());
    assert.equal(result.rows[0].priceAsOf.toISOString(),receipt.toISOString());
    const fx=await kis.fetchKisUsdKrwFxCandidate({fetchedAt:request,rateDate:'2026-09-25',target:{ticker:'UNIT',exchange:'NAS'}});
    assert.equal(fx.fetchedAt,receipt.toISOString());assert.equal(fx.providerTimestamp,undefined);
  } finally {
    t.mock.timers.reset();
    for(const [key,value] of [['KIS_APP_KEY',previous.key],['KIS_APP_SECRET',previous.secret]]) if(value===undefined) delete process.env[key];else process.env[key]=value;
  }
});

it('validated US exchange hints eliminate repeat probes but recover from listing changes without cached prices',async()=>{
  const previous={key:process.env.KIS_APP_KEY,secret:process.env.KIS_APP_SECRET};
  process.env.KIS_APP_KEY='synthetic-only';process.env.KIS_APP_SECRET='synthetic-only';
  const calls=[];let listed='AMS',price='105';
  try {
    const [kis]=await importWithPorts(['src/lib/market-data/providers/kis.ts'],{
      './kis-token-lifecycle':{getReusableKisAccessToken:async()=> 'synthetic-only'},
      '@/lib/market-data/provider-budget':{fetchKisWithBudget:async(_config,url)=>{
        const request=new URL(url),exchange=request.searchParams.get('EXCD');calls.push(exchange);
        if(exchange!==listed)return Response.json({rt_cd:'0',output:{last:'0'},output2:[]});
        if(request.pathname.endsWith('price-detail'))return Response.json({rt_cd:'0',output:{curr:'USD',t_rate:'1300'}});
        if(request.pathname.endsWith('dailyprice'))return Response.json({rt_cd:'0',output2:[{xymd:new Date().toISOString().slice(0,10).replaceAll('-',''),clos:price}]});
        return Response.json({rt_cd:'0',output:{last:price}});
      }},
    });
    const target={ticker:'TESTETF',market:'us',currency:'USD',assetIds:[]};
    const context={requestedAt:new Date(),priceDate:new Date().toISOString().slice(0,10),mode:'live',dryRun:false,fixture:false};
    const live=()=>kis.createKisMarketDataProvider().fetchLiveQuotes([target],context);
    assert.equal((await live()).rows[0].price,'105');assert.deepEqual(calls.splice(0),['NAS','NYS','AMS']);
    price='106';assert.equal((await live()).rows[0].price,'106');assert.deepEqual(calls.splice(0),['AMS']);
    await kis.createKisMarketDataProvider().fetchClosePrices([target],{...context,mode:'close'});assert.deepEqual(calls.splice(0),['AMS']);
    await kis.fetchKisUsdKrwFxCandidate({rateDate:context.priceDate,target:{ticker:target.ticker,exchange:null}});assert.deepEqual(calls.splice(0),['AMS']);
    listed='NYS';price='107';assert.equal((await live()).rows[0].price,'107');assert.deepEqual(calls.splice(0),['AMS','NAS','NYS']);
    assert.equal((await live()).rows[0].price,'107');assert.deepEqual(calls.splice(0),['NYS']);
    price='0';assert.equal((await live()).rows[0].status,'error');assert.equal(calls.length,3,'an invalid response is never replaced with a remembered price');
  } finally {
    for(const [key,value] of [['KIS_APP_KEY',previous.key],['KIS_APP_SECRET',previous.secret]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});

it('exchange hints expire, have a fixed memory bound, and do not cross real/mock endpoints',async()=>{
  const [{KisExchangeHints}]=await importWithPorts(['src/lib/market-data/providers/kis-exchange-hints.ts'],{});
  const hints=new KisExchangeHints();hints.remember('real','voo','AMS',1000);
  assert.deepEqual(hints.order('real','VOO',null,1001),['AMS','NAS','NYS']);
  assert.deepEqual(hints.order('mock','VOO',null,1001),['NAS','NYS','AMS']);
  assert.deepEqual(hints.order('real','VOO',null,1000+86400000),['NAS','NYS','AMS']);
  for(let i=0;i<513;i++)hints.remember('real',`T${i}`,'AMS',1000);
  assert.deepEqual(hints.order('real','T0',null,1001),['NAS','NYS','AMS']);
  assert.deepEqual(hints.order('real','T512',null,1001),['AMS','NAS','NYS']);
});
