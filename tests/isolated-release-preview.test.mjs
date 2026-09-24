import assert from 'node:assert/strict';
import {it} from 'node:test';
import {ISOLATED_RELEASE_PREVIEW as pinned,isIsolatedReleasePreview} from '../src/lib/deployment/isolated-release-preview.ts';
import {assessAuthTransportEnvironment,createAuthTransportBaseUrlFingerprint} from '../src/lib/auth/auth-transport-policy.ts';
import {getVercelBuildSteps,runVercelBuild} from '../scripts/vercel-build.mjs';
const url=(user,password)=>`postgresql://${user}:${password}@${pinned.endpoint}.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require`;
const env=()=>({VERCEL_ENV:'preview',BC_ISOLATED_PREVIEW_ENABLED:'true',VERCEL_GIT_COMMIT_REF:pinned.branch,NEON_PROJECT_ID:pinned.project,NEON_AUTH_BASE_URL:pinned.authBaseUrl,NEON_AUTH_BASE_URL_SHA256:createAuthTransportBaseUrlFingerprint(pinned.authBaseUrl),NEON_AUTH_COOKIE_SECRET:'synthetic-secret-'.repeat(4),DATABASE_URL:url('neondb_owner','synthetic_admin'),DATABASE_URL_UNPOOLED:url('neondb_owner','synthetic_admin'),TENANT_DATABASE_URL:url('varda_tenant_app','synthetic_tenant')});
it('allows only the independently provisioned Preview target without build-time migrations',()=>{
 const e=env();assert.equal(isIsolatedReleasePreview(e),true);assert.deepEqual(assessAuthTransportEnvironment(e),{state:'ready'});
 assert.deepEqual(getVercelBuildSteps('preview',e),['db:preview:release-verify','build']);
 const calls=[];runVercelBuild({env:e,spawn:(_c,args)=>{calls.push(args.at(-1));return {status:0};},log:()=>{}});assert.deepEqual(calls,['db:preview:release-verify','build']);
});
it('rejects target, environment, branch and credential changes before auth or build commands',()=>{
 for(const [key,value] of [['VERCEL_ENV','development'],['VERCEL_GIT_COMMIT_REF','master'],['NEON_PROJECT_ID','other'],['NEON_AUTH_BASE_URL','https://other.example/auth'],['BC_ISOLATED_PREVIEW_ENABLED','false'],['TENANT_DATABASE_URL',url('neondb_owner','synthetic_admin')],['TENANT_DATABASE_URL',url('varda_tenant_app','synthetic_%61dmin')]]){
  const e={...env(),[key]:value};assert.equal(isIsolatedReleasePreview(e),false,key);assert.deepEqual(assessAuthTransportEnvironment(e),{state:'disabled'});
  if(e.VERCEL_ENV==='preview'&&e.BC_ISOLATED_PREVIEW_ENABLED==='true')assert.throws(()=>runVercelBuild({env:e,spawn:()=>assert.fail('must not spawn'),log:()=>{}}),/target verification/);
 }
});
it('rejects parser-routing overrides, duplicate SSL options and nonstandard targets',()=>{
 for(const key of ['DATABASE_URL','DATABASE_URL_UNPOOLED','TENANT_DATABASE_URL'])for(const suffix of ['&host=other.example','&database=other','&user=other','&password=other','&options=-csearch_path=other','&port=5433','&sslmode=disable','&channel_binding=disable','#fragment'])assert.equal(isIsolatedReleasePreview({...env(),[key]:env()[key]+suffix}),false,`${key} ${suffix}`);
 for(const altered of [url('neondb_owner','synthetic_admin').replace('.tech/neondb','.tech/other'),url('neondb_owner','synthetic_admin').replace('.tech/', '.tech:5433/'),url('neondb_owner','synthetic_admin').replace('sslmode=require','sslmode=disable')])assert.equal(isIsolatedReleasePreview({...env(),DATABASE_URL:altered,DATABASE_URL_UNPOOLED:altered}),false);
});
it('retains fingerprint/cookie requirements and leaves unrelated Preview auth disabled',()=>{
 assert.deepEqual(assessAuthTransportEnvironment({...env(),NEON_AUTH_BASE_URL_SHA256:''}),{state:'misconfigured'});
 assert.deepEqual(assessAuthTransportEnvironment({...env(),NEON_AUTH_COOKIE_SECRET:''}),{state:'misconfigured'});
 assert.deepEqual(assessAuthTransportEnvironment({VERCEL_ENV:'preview'}),{state:'disabled'});
});
