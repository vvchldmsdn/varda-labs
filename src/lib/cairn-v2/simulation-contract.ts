import type {BetaContext} from './navigation';
import type {SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY} from '../shared-domain/simulation-owner-research-execution';
import {SIMULATION_RESEARCH_HORIZON_POLICY} from '../simulation-research-horizon';
export {SIMULATION_RESEARCH_HORIZON_POLICY};
export type OwnerSimulationModel=ReturnType<typeof import('./simulation-adapter').adaptOwnerResearch>;
export type SimulationState='idle'|'loading'|'ready'|'partial'|'empty'|'unsupported'|'invalid'|'unavailable'|'unauthorized';
export type SimulationRead={context:BetaContext;state:SimulationState;message:string;model:OwnerSimulationModel|null;scopes:{key:string;label:string;detail:string}[];serviceDate:string|null;generatedAt:string|null;resultIdentity?:string;readReceipt?:string;readEpoch?:string;policy?:typeof SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY};
export const simulationKey=(c:BetaContext)=>JSON.stringify([c.mode,c.scope,c.currency,c.horizon??String(SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon),c.end??null,c.run??null]);
export function blankSimulation(context:BetaContext,state:SimulationState,message:string):SimulationRead{return {context,state,message,model:null,scopes:[],serviceDate:null,generatedAt:null};}
