import 'server-only';
import {eq} from 'drizzle-orm';
import {db} from '@/db/client';
import {etfMasters} from '@/db/schema';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '../auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '../../db/queries/portfolio-analysis-scopes';
import {searchReadOnlyEtfMasters,getReadOnlyEtfHoldings} from '../../db/queries/etf-holdings';
import {canonicalBetaReadEpoch} from './read-freshness';
import {readBetaEtf} from './etf-service';
import type {EtfParams} from './etf-contract';
export async function getBetaEtfRead(params:EtfParams){return {...await readBetaEtf(params,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext,search:searchReadOnlyEtfMasters,holdings:getReadOnlyEtfHoldings,master:readPublicEtfMaster}),readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead),readAt:new Date().toISOString()};}

// Narrow lookup only when an explicit ID is outside the bounded search results.
async function readPublicEtfMaster(id:string){const rows=await db.select({id:etfMasters.id,ticker:etfMasters.ticker,name:etfMasters.name,market:etfMasters.market,currency:etfMasters.currency}).from(etfMasters).where(eq(etfMasters.id,id)).limit(1);return rows[0]??null;}
