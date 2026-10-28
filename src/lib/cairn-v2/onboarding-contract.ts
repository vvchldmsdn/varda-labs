import type {BetaContext} from './navigation';
import {betaHref,betaReadHref} from './navigation';
import type {HoldingOnboardingOptions} from '../../db/queries/holding-onboarding';
export type HoldingOnboardingRead={context:BetaContext;state:'ready'|'empty'|'loading'|'unauthorized'|'unavailable';message:string;scopes:{key:string;label:string;detail:string}[];options:HoldingOnboardingOptions|null;nativeAccountIds:readonly string[];allowUnknownAverageCost:boolean;queryKey?:string;readReceipt?:string;readEpoch?:string;readAt?:string};
export function onboardingKey(context:BetaContext){return JSON.stringify(['holding-onboarding-v1',context.mode,context.scope,context.currency]);}
export function onboardingHref(context:BetaContext,epoch?:string|null){const url=new URL(betaHref('/beta/portfolio/structure',context),'https://beta.invalid');url.pathname='/beta/portfolio/holdings/new';url.hash='holding-onboarding';return betaReadHref(url.pathname+url.search+url.hash,epoch);}
export function onboardingGeneration(context:BetaContext,epoch:string|undefined|null,receipt:string|undefined){return JSON.stringify([onboardingKey(context),epoch??'initial',receipt??'no-receipt']);}
export function blankOnboarding(context:BetaContext,state:HoldingOnboardingRead['state'],message:string):HoldingOnboardingRead{return {context,state,message,scopes:[],options:null,nativeAccountIds:[],allowUnknownAverageCost:false};}
