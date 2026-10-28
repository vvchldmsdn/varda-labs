import 'server-only';
import { createHash } from 'node:crypto';
import { readCurrentSessionSubject } from '@/lib/auth/current-session-subject';
import { resolveCurrentTenantContext } from '@/lib/auth/current-tenant-context';
import { readNativeLedger } from '@/db/queries/native-portfolio-ledger';
import { releaseOwnerAllowed } from '@/lib/release-admission';
import { photoImportEntries, type TradeImportContext } from '@/lib/trade-photo-import';

/** Keep identity fields in the server boundary; the page receives only its product DTO. */
export async function readTradePhotoImportContext(): Promise<TradeImportContext | null> {
  const subject = await readCurrentSessionSubject();
  const tenant = await resolveCurrentTenantContext();
  if (subject.state !== 'authenticated' || !tenant.ok) return null;
  const ledger = await readNativeLedger(tenant.tenantContext);
  return { sessionKey: createHash('sha256').update(`native-ledger\0${subject.provider}\0${subject.providerSubject}`).digest('hex'), serverNow: new Date().toISOString(),
    canWrite: releaseOwnerAllowed(process.env, 'NATIVE_LEDGER', tenant.tenantContext.ownerUserId), complete: ledger.accountsComplete && ledger.entriesComplete,
    accounts: ledger.accounts, entries: photoImportEntries(ledger.entries) };
}
