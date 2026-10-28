import 'server-only';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '../auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '../../db/queries/portfolio-analysis-scopes';
import {getReadOnlyTenantEvents} from '../../db/queries/tenant-events';
import {canonicalBetaReadEpoch} from './read-freshness';
import {eventKey} from './event-contract';
import {domainContext} from './read-service';
import {readBetaEvents} from './event-service';
export async function getBetaEventRead(params:Record<string,string|string[]|undefined>){return {...await readBetaEvents(params,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext,events:getReadOnlyTenantEvents}),queryKey:eventKey(domainContext(params),params.date??null),readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead),readAt:new Date().toISOString()};}
