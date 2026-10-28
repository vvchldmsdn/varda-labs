import assert from 'node:assert/strict';
import {expectedCloseDates,planCloseGapJobs,closeIdentity} from '../../src/lib/market-data/close-gap-policy';
import {calculateInvestmentLabModifiedDietz} from '../../src/lib/investment-lab-modified-dietz';
const us={ticker:'VOO',market:'us',currency:'USD'} as const,kr={ticker:'069500',market:'korea',currency:'KRW'} as const;
const now=new Date('2026-10-16T07:01:00+09:00');
const usDates=expectedCloseDates(us,now),krDates=expectedCloseDates(kr,now);
assert.ok(usDates.includes('2026-10-09'));assert.ok(!krDates.includes('2026-10-09'));
assert.ok(!usDates.includes('2026-10-10')&&!usDates.includes('2026-10-11'));
assert.equal(usDates.at(-1),'2026-10-15');
assert.equal(expectedCloseDates(us,new Date('2026-10-16T06:59:00+09:00')).at(-1),'2026-10-14');
const present=new Set([...usDates.map(d=>closeIdentity(us,d)),...krDates.map(d=>closeIdentity(kr,d))]);
assert.equal(planCloseGapJobs([us,kr],present,now).length,0);
present.delete(closeIdentity(us,'2026-10-08'));present.delete(closeIdentity(us,'2026-10-14'));
const jobs=planCloseGapJobs([us,us,kr],present,now);
assert.equal(jobs.length,1);assert.equal(jobs[0].startDate,'2026-10-08');assert.equal(jobs[0].endDate,'2026-10-14');
present.add(closeIdentity(us,'2026-10-08'));
assert.equal(planCloseGapJobs([us],present,now)[0].startDate,'2026-10-14');
assert.equal(planCloseGapJobs([{...us,ticker:'../bad'}],new Set(),now).length,0);
assert.equal(planCloseGapJobs([{...us,firstCloseDate:'2026-10-14'}],new Set(),now)[0].startDate,'2026-10-14');
const result=calculateInvestmentLabModifiedDietz({valuations:[
 {serviceDate:'2026-10-08',valueKrw:1000},{serviceDate:'2026-10-09',valueKrw:1500},
 {serviceDate:'2026-10-10',valueKrw:1500},{serviceDate:'2026-10-11',valueKrw:1500},{serviceDate:'2026-10-13',valueKrw:900},
],flows:[{effectiveServiceDate:'2026-10-09',sequence:1,direction:'inflow',amountKrw:500},
 {effectiveServiceDate:'2026-10-13',sequence:2,direction:'outflow',amountKrw:600}]});
assert.equal(result.status,'ready');assert.equal(result.totalReturn,0);
console.log('PASS: exchange holidays, cutoff, deduplication, partial retry, invalid identity, buy/sell flow neutrality');
