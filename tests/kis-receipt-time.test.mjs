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
