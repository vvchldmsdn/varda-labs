'use server';
import { revalidatePath } from 'next/cache';
import { savePortfolioTargetPolicy } from '@/app/portfolio/targets/actions';
import type { PortfolioTargetPolicyActionState } from '@/lib/shared-backend/target-policy';
import { requireAlignedBackendSource } from '@/lib/shared-backend/selection';
// Backend boundary ready for the existing target editor; no new editing UI or
// route is enabled in the read-only Preview by this source-alignment bundle.
export async function saveBetaTargetPolicy(previous: PortfolioTargetPolicyActionState, data: FormData) {
  await requireAlignedBackendSource();
  const result = await savePortfolioTargetPolicy(previous, data);
  if (result.status === 'success') revalidatePath('/beta', 'layout');
  return result;
}
