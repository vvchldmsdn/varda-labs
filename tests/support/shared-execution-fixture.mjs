import { readyOwnerMatrix } from './simulation-owner-ready-matrix.mjs';
import { prepareSimulationResearchPaths, executeSimulationResearchPathsFromPrepared } from '../../src/lib/simulation-research-execution-core.ts';
import { buildSimulationOwnerEconomicResearch } from '../../src/lib/simulation-owner-economic-research.ts';
import { bootstrapPathSnapshot, economicPathSnapshot } from '../../src/lib/simulation-path-snapshot.ts';
export function executionFixture(model='economic', assets=3, horizon=21) {
  const matrix=readyOwnerMatrix();
  const template=matrix.instruments[0];
  matrix.instruments=Array.from({length:assets},(_,i)=>({...template,instrumentKey:`korea|KRW|ASSET${String(i).padStart(2,"0")}`,ticker:`ASSET${String(i).padStart(2,"0")}`}));
  matrix.matrix=matrix.matrix.map((row,t)=>({...row,cells:matrix.instruments.map((asset,i)=>({...row.cells[0],instrumentKey:asset.instrumentKey,value:0.0002+Math.sin(t*.71+i*.3)*.009+Math.cos(t*.19+i)*.003}))}));
  Object.assign(matrix.summary,{requestedInstrumentCount:assets,includedInstrumentCount:assets,totalCellCount:90*assets,readyCellCount:90*assets});
  const weights=matrix.instruments.map((a,i)=>({...a,weightBps:Math.floor(10000/assets)+(i<10000%assets?1:0)}));
  const prepared=model==='bootstrap'?prepareSimulationResearchPaths({matrix,seed:42,expectedBlockLength:5,horizon,pathCount:1000}):null;
  if(prepared && prepared.status!=='ready') throw Error(prepared.reason);
  const execution={...(prepared?executeSimulationResearchPathsFromPrepared({prepared,scenarioId:'storage-test',scenarioVersion:'1',weights,samplePathCount:12,includeDisplayPaths:true}):{}),account:'all',executionWeights:weights,instruments:matrix.instruments.map(a=>({...a,name:a.ticker})),coverage:{modeledCurrentValuePct:80},source:{endServiceDate:matrix.requestedServiceDates.at(-1)}};
  if(model==='bootstrap') return bootstrapPathSnapshot(execution,prepared);
  const factorRows=matrix.requestedServiceDates.flatMap((date,i)=>[['usdkrw',1300+i*.7+Math.sin(i/5)*4],['us_10y_yield',4+Math.sin(i/7)*.08],['us_10y2y_curve',.2+Math.cos(i/9)*.04]].map(([factorKey,value])=>({factorKey,value,factorDate:date,periodEndDate:date,releaseDate:date,volatility20dPct:1})));
  const economic=buildSimulationOwnerEconomicResearch({account:'all',matrix,weights,horizon,ownerExecutionReady:true,factorRows,includeDisplayPaths:true});
  if(economic.status!=='ready') throw Error(`fixture ${economic.status}`);
  return economicPathSnapshot(economic,execution);
}



