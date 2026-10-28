import type {BetaContext} from './navigation';
import {betaHref,betaReadHref} from './navigation';
import type {TenantHoldingDto} from '../tenant-holding-read-model';
import type {PortfolioGroupManagementModel} from '../../db/queries/portfolio-group-management';
export type ManagementKind='holdings'|'groups';
export type ManagedHolding=Pick<TenantHoldingDto,'holdingId'|'name'|'ticker'|'accountName'|'quantity'|'averageCost'|'currency'|'market'|'archivedAt'|'updatedAt'>;
export type OwnedManagementRead={kind:ManagementKind;context:BetaContext;state:'ready'|'partial'|'empty'|'loading'|'unauthorized'|'unavailable';message:string;scopes:{key:string;label:string;detail:string}[];serviceDate:string|null;holdings:ManagedHolding[];groups:PortfolioGroupManagementModel|null;excludedHoldingCount:number;allowUnknownAverageCost:boolean;queryKey?:string;readReceipt?:string;readEpoch?:string;readAt?:string};
export function ownedManagementKey(kind:ManagementKind,context:BetaContext){return JSON.stringify(['owned-management-v1',kind,context.mode,context.scope,context.currency]);}
export function ownedManagementHref(kind:ManagementKind,context:BetaContext,epoch?:string|null){const url=new URL(betaHref('/beta/portfolio/structure',context),'https://beta.invalid');url.pathname=kind==='holdings'?'/beta/portfolio/holdings/manage':'/beta/portfolio/groups';url.hash=kind==='holdings'?'holdings-management':'group-management';return betaReadHref(url.pathname+url.search+url.hash,epoch);}
export function blankOwnedManagement(kind:ManagementKind,context:BetaContext,state:OwnedManagementRead['state'],message:string):OwnedManagementRead{return {kind,context,state,message,scopes:[],serviceDate:null,holdings:[],groups:null,excludedHoldingCount:0,allowUnknownAverageCost:false};}

export function ownedManagementGeneration(kind:ManagementKind,context:BetaContext,epoch:string|undefined|null,receipt:string|undefined){return JSON.stringify([ownedManagementKey(kind,context),epoch??'initial',receipt??'no-receipt']);}
