import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, stageSource, childEnvironment } from './reliability-ci.mjs';

/** Substitute only the external verified identity boundary in a disposable source copy. */
export async function prepareFullApp(stage) {
  await stageSource(ROOT, stage);
  const fixture = path.join(stage, 'src/lib/auth/current-session-subject.ts');
  await writeFile(fixture, `import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import type { CurrentSessionSubjectResult } from './provider-session-contract';
export type { CurrentSessionSubjectResult } from './provider-session-contract';
export const readCurrentSessionSubject = cache(async (): Promise<CurrentSessionSubjectResult> => {
  const token = (await cookies()).get('cairn_fullapp_identity')?.value;
  const identities = JSON.parse(process.env.CAIRN_FULLAPP_IDENTITIES ?? '{}') as Record<string,string>;
  const subject = token ? identities[token] : undefined;
  return subject ? {state:'authenticated',provider:'neon_auth',providerSubject:subject} : {state:'unauthenticated'};
});
`);
  // A disposable-only control invokes the real App Router refresh. It never
  // substitutes financial queries, returned props, or React state.
  await writeFile(path.join(stage, 'src/components/fullapp-refresh-control.tsx'), [
    '"use client";',
    'import {useEffect} from "react";',
    'import {useRouter} from "next/navigation";',
    'export function FullAppRefreshControl(){const router=useRouter();useEffect(()=>{const refresh=()=>router.refresh();window.addEventListener("cairn-fullapp-refresh",refresh);return()=>window.removeEventListener("cairn-fullapp-refresh",refresh);},[router]);return null;}',
  ].join('\n'));
  const layout=path.join(stage,'src/app/layout.tsx');
  const layoutSource=await readFile(layout,'utf8');
  assert.ok(layoutSource.includes('<body>'));
  await writeFile(layout,'import {FullAppRefreshControl} from "@/components/fullapp-refresh-control";\n'+layoutSource.replace('<body>','<body><FullAppRefreshControl />'));
  // Presentation fixtures exist in the disposable app only. The real components,
  // layout, locale provider and CSS render here; no financial write is involved.
  const qaRoute = 'src/app/qa-context-presentation';
  await assert.rejects(access(path.join(ROOT, qaRoute)), { code: 'ENOENT' });
  const {readyOwnerMatrix,ownerWeights} = await import('../tests/support/simulation-owner-ready-matrix.mjs');
  const {prepareSimulationResearchPaths,executeSimulationResearchPathsFromPrepared} = await import('../src/lib/simulation-research-execution-core.ts');
  const {buildSimulationOwnerCandidateComparison} = await import('../src/lib/simulation-owner-candidate-comparison.ts');
  const prepared=prepareSimulationResearchPaths({matrix:readyOwnerMatrix(),seed:0x56415244,expectedBlockLength:5,horizon:63,pathCount:500});
  assert.equal(prepared.status,'ready');
  const currentWeights=ownerWeights([5000,2500,2500]);
  const currentExecution=executeSimulationResearchPathsFromPrepared({prepared,scenarioId:'owner-current-all',scenarioVersion:'v1',weights:currentWeights,samplePathCount:12});
  const comparison=buildSimulationOwnerCandidateComparison({account:'all',prepared,currentExecution,currentWeights,samplePathCount:12});
  assert.equal(comparison.status,'ready');assert.ok(comparison.outcomeCandidates.length>=2);
  await mkdir(path.join(stage,qaRoute));
  await writeFile(path.join(stage,qaRoute,'fixture.json'),JSON.stringify({candidates:comparison.outcomeCandidates,currentExecution,reason:comparison.outcomeCandidateReason,status:comparison.outcomeCandidateStatus}));
  await writeFile(path.join(stage,qaRoute,'page.tsx'), `
import {OwnerOutcomeCandidateExplorer} from '@/components/simulation/owner-outcome-candidate-explorer';
import {EventTable,EventEvidence} from '@/components/cairn-v2/event-table';
import {PositionSnapshotTable,SnapshotEvidence} from '@/components/cairn-v2/snapshot-table';
import {LanguageSwitch} from '@/components/i18n/language-switch';
import data from './fixture.json';
const event={eventDate:'2026-09-18',recordedAt:'2026-09-18T10:00:00.123Z',accountCode:'brokerage',accountName:'QA account',ticker:'VOO',assetName:'QA ETF',eventType:'buy',eventKind:'trade',assetReferenceStatus:'stored_asset_reference',correctionStatus:'none',evidenceStatus:'partial',missingFields:['price'],amountKrw:123,quantityDelta:0.896567} satisfies Parameters<typeof EventTable>[0]['rows'][number];
const model={state:'ready',snapshotDate:'2026-09-18',source:'synthetic',expectedAccounts:['synthetic'],coveredAccounts:['synthetic'],missingAccounts:[],excludedPositionCount:0,linkedPositionCount:1,historicalOnlyPositionCount:0,positions:[{accountCode:'synthetic',accountName:'QA account',assetName:'QA ETF',ticker:'VOO',assetType:'etf',market:'us',currency:'USD',quantity:'0.896567',storedPrice:'701.263896',storedPriceKind:'current_price',marketValueKrw:'123.456789',currentWeight:'100',targetWeight:null,belowMa:false,priceSource:'synthetic',priceBasis:'manual_current',assetLinkStatus:'linked'}]} satisfies Parameters<typeof PositionSnapshotTable>[0]['model'];
export default function Page(){return <main style={{padding:20,maxWidth:1200,margin:'auto'}}><LanguageSwitch/><p>Synthetic presentation fixture — no account writes</p><section aria-label="Record presentation"><EventTable rows={[event]}/><PositionSnapshotTable model={model}/><details><summary>Source details</summary><EventEvidence rows={[event]}/><SnapshotEvidence model={model}/></details></section><OwnerOutcomeCandidateExplorer account="all" {...data as Omit<Parameters<typeof OwnerOutcomeCandidateExplorer>[0],'account'>}/></main>}
`);
  const visualRoute='src/app/qa-beta-visual';
  await assert.rejects(access(path.join(ROOT,visualRoute)),{code:'ENOENT'});
  const {importUiWithPorts}=await import('../tests/helpers/import-ui-with-ports.mjs');
  const [fixtures,contract]=await importUiWithPorts(['src/lib/cairn-v2/fixtures.ts','src/lib/cairn-v2/read-contract.ts'],{});
  const {betaVisualFixture,returnVisualFixture}=await import('../tests/support/beta-visual-fixture.mjs');
  const context={mode:'domain',scope:'all',currency:'KRW',fixture:'standard'};
  const view=betaVisualFixture(fixtures.getFixtureView(context),contract.blankDomainView('ready',''));
  await mkdir(path.join(stage,visualRoute));
  await writeFile(path.join(stage,visualRoute,'fixture.json'),JSON.stringify({context,view,returns:returnVisualFixture,displayBinding:'b'.repeat(64)}));
  await writeFile(path.join(stage,visualRoute,'page.tsx'), `
import {BetaProvider} from '@/components/cairn-v2/beta-provider';
import {BetaHome} from '@/components/cairn-v2/beta-home';
import {BetaWorkspace} from '@/components/cairn-v2/beta-workspace';
import {ReturnTimelineChart} from '@/components/return-timeline-chart';
import {ContributionFundingVisual} from '@/components/cairn-v2/reused/contribution-funding';
import type {DomainRead} from '@/lib/cairn-v2/read-contract';
import type {RecoveredReturnCurve} from '@/lib/period-return-recovery';
import data from './fixture.json';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const search=await searchParams;const read={...data,context:{...data.context,currency:search.currency==='USD'?'USD':'KRW'}} as DomainRead;
if(search.workspace==='history')return <BetaProvider><BetaWorkspace kind="history" initialContext={read.context} read={read}/></BetaProvider>;
return <BetaProvider><BetaHome initialContext={read.context} read={read}/><section aria-label="Synthetic funding" style={{maxWidth:900,margin:"40px auto",padding:24}}><ContributionFundingVisual cash={1000000} trims={400000} total={1400000} residual={200000} rows={[{key:"VOO",name:"VOO",amount:700000},{key:"KR",name:"KODEX 200",amount:500000}]}/></section><section aria-label="Synthetic recovered history" style={{maxWidth:1000,margin:'40px auto',padding:20}}><ReturnTimelineChart stored={data.returns.stored} curve={data.returns.curve as RecoveredReturnCurve}/></section></BetaProvider>}
`);
  const originalVisualRoute='src/app/qa-original-visual';
  await assert.rejects(access(path.join(ROOT,originalVisualRoute)),{code:'ENOENT'});
  await mkdir(path.join(stage,originalVisualRoute));
  await writeFile(path.join(stage,originalVisualRoute,'page.tsx'), `
import {PortfolioDashboard} from '@/components/portfolio-dashboard';
import {buildHomeDesignPreview} from '@/lib/home-design-preview';
export default function Page(){return <PortfolioDashboard data={buildHomeDesignPreview(undefined)} designPreview/>}
`);
  return { identityBoundary: 'external verified session subject substituted only in disposable build',
    sourceIdentitySha256: createHash('sha256').update(await readFile(path.join(ROOT, 'src/lib/auth/current-session-subject.ts'))).digest('hex') };
}

export async function main(args) {
  assert.ok(args.length === 2 || args.length === 4, 'Use --pg-bin <absolute PostgreSQL binary directory> [--output-dir <absolute empty directory>]');
  assert.equal(args[0], '--pg-bin'); assert.ok(path.isAbsolute(args[1]));
  const outputRoot = path.join(ROOT, 'output/reliability-fullapp');
  await mkdir(outputRoot, { recursive: true });
  if (args.length === 4) { assert.equal(args[2], '--output-dir'); assert.ok(path.isAbsolute(args[3])); }
  const output = args.length === 4 ? args[3] : await mkdtemp(path.join(outputRoot, 'local-'));
  if (args.length === 4) await mkdir(output);
  const stage = path.join(output, 'workspace');
  const report = { status: 'FAIL', cases: [], auth: 'NOT RUN: real email and OAuth', output };
  try {
    await mkdir(stage);
    report.isolation = await prepareFullApp(stage);
    const { chromium } = await import('@playwright/test');
    const browserCache = path.dirname(path.dirname(path.dirname(chromium.executablePath())));
    const environment = childEnvironment(process.env, stage, 'production-build', browserCache);
    const log = createWriteStream(path.join(output, 'build.log'));
    // Exercise the same local OCR assets as npm prebuild; never substitute an OCR response.
    for (const command of [['scripts/prepare-balance-ocr.mjs'], ['scripts/verify-shared-domains.mjs'], ['node_modules/next/dist/bin/next', 'build', '--webpack']]) {
      const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, command,
        { cwd: stage, env: environment, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
      child.once('error', reject); child.once('close', resolve);
      });
      if (code !== 0) { await new Promise(resolve => log.end(resolve)); throw new Error('Full-app isolated production build failed; inspect build.log'); }
    }
    await new Promise(resolve => log.end(resolve));
    report.build = 'PASS';
    const runner = await import(pathToFileURL(path.join(stage, 'scripts/krw-usd-rc-rehearsal.mjs')).href);
    const result = await runner.rehearseReliabilityFullApp(['--execute-local', '--pg-bin', args[1]], output, stage, browserCache);
    Object.assign(report, result);
    assert.equal(result.status, 'PASS', result.testFailure ?? 'Actual Next app browser journey failed');
  } catch (error) {
    report.status = 'FAIL'; report.error = String(error.message).slice(0, 600);
  }
  if (report.isolation) {
    const originalIdentity = await readFile(path.join(ROOT, 'src/lib/auth/current-session-subject.ts'));
    assert.equal(createHash('sha256').update(originalIdentity).digest('hex'), report.isolation.sourceIdentitySha256, 'Original production auth source changed during rehearsal');
    assert.ok(!originalIdentity.toString().includes('cairn_fullapp_identity'), 'Production identity source cannot contain the test fixture');
    assert.ok(!(await readFile(path.join(ROOT,'src/app/layout.tsx'),'utf8')).includes('FullAppRefreshControl'), 'Refresh control must stay in disposable builds');
    await assert.rejects(access(path.join(ROOT,'src/app/qa-context-presentation')), { code: 'ENOENT' });
    await assert.rejects(access(path.join(ROOT,'src/app/qa-beta-visual')), { code: 'ENOENT' });
    await assert.rejects(access(path.join(ROOT,'src/app/qa-original-visual')), { code: 'ENOENT' });

  }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status:report.status,report:path.join(output,'report.json'),error:report.error}));
  return report;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(report => { process.exitCode = report.status === 'PASS' ? 0 : 1; });
}
