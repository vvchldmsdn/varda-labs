import 'server-only';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '../auth/current-tenant-context';
import {getReadOnlyTenantSnapshotScopeContext} from '../../db/queries/tenant-snapshot-scopes';
import {getReadOnlyTenantPortfolioSnapshots} from '../../db/queries/tenant-portfolio-snapshots';
import {getReadOnlyTenantPositionSnapshots} from '../../db/queries/tenant-position-snapshots';
import {canonicalBetaReadEpoch} from './read-freshness';
import {domainContext} from './read-service';
import {snapshotKey,type SnapshotKind} from './snapshot-contract';
import {readBetaSnapshots} from './snapshot-service';
export async function getBetaSnapshotRead(params:Record<string,string|string[]|undefined>,kind:SnapshotKind='accounts'){
 return {...await readBetaSnapshots(params,kind,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantSnapshotScopeContext,accounts:getReadOnlyTenantPortfolioSnapshots,positions:getReadOnlyTenantPositionSnapshots}),queryKey:snapshotKey(domainContext(params),params.date??null,kind),readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead),readAt:new Date().toISOString()};
}
