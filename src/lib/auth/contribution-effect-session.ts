import 'server-only';
import { createHash } from 'node:crypto';
import { readCurrentSessionSubject } from '@/lib/auth/current-session-subject';
import { resolveCurrentTenantContext } from '@/lib/auth/current-tenant-context';
export async function effectSession() {
  const subject = await readCurrentSessionSubject();
  if (subject.state !== 'authenticated') return null;
  const tenant = await resolveCurrentTenantContext();
  if (!tenant.ok) return null;
  return { tenant: tenant.tenantContext, key: createHash('sha256').update(`contribution-effect\0${subject.provider}\0${subject.providerSubject}\0${tenant.tenantContext.ownerUserId}`).digest('hex') };
}
