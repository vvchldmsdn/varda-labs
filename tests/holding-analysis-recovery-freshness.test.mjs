import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importUiWithPorts} from './helpers/import-ui-with-ports.mjs';

const context={mode:'domain',scope:'all',currency:'KRW'};
function nodes(value){return Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];}
test('both beta research screens discard recovery reads during owner refresh and remount for the new receipt',async()=>{
  let blocked=false;
  const Recovery=()=>null;
  const ports={
    react:{useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useTransition:()=>[false,()=>{}],useLayoutEffect:()=>{}},
    'next/navigation':{useRouter:()=>({}),useSearchParams:()=>new URLSearchParams(context)},
    'next/link':{default:()=>null},
    '@/components/holding-analysis-recovery':{HoldingAnalysisRecovery:Recovery},
    '@/components/recovery/recovery-notice':{RecoveryNotice:()=>null},
    '@/components/cairn-v2/beta-provider':{useBetaExistingCrudAvailable:()=>true,useBetaReadFreshness:()=>({store:{blocked:()=>blocked,pendingEpoch:()=>null}})},
    '@/components/cairn-v2/beta-shell':{BetaShell:()=>null},
    '@/components/cairn-v2/use-beta-context':{useBetaContext:()=>[context,()=>{}]},
    '@/components/cairn-v2/simulation-result-detail':{default:()=>null},
    '@/components/investment-lab/investment-lab-comparison-chart':{InvestmentLabComparisonChart:()=>null},
    '@/components/cairn-v2/reused/lab-observed-chart':{ObservedHistoryChart:()=>null},
    '@/lib/cairn-v2/read-service':{domainContext:()=>context,domainQueryValid:()=>true},
  };
  const [{BetaLab},{BetaSimulation},lab]=await importUiWithPorts(['src/components/cairn-v2/beta-lab.tsx','src/components/cairn-v2/beta-simulation.tsx','src/lib/cairn-v2/lab-contract.ts'],ports);
  for(const Component of [BetaLab,BetaSimulation]){
    const base={...lab.blankLab(context,'unavailable','missing history'),context,model:null,scopes:[],readReceipt:'owner-a',readEpoch:'epoch-a'};
    const recovery=read=>nodes(Component({read})).find(node=>node.type===Recovery);
    const first=recovery(base);assert.ok(first);
    blocked=true;assert.equal(recovery(base),undefined,'hide old owner data until admitted');blocked=false;
    for(const state of ['loading','unauthorized','invalid'])assert.equal(recovery({...base,state}),undefined);
    assert.ok(recovery({...base,state:'idle'}),'admitted initial screen can inspect readiness before running');
    const next=recovery({...base,readReceipt:'owner-b',readEpoch:'epoch-b'});
    assert.ok(next);assert.notEqual(next.key,first.key,'React must discard old hooks and delayed reads at the same all scope');
  }
});
