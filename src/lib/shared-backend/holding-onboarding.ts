import 'server-only';
import {writeSessionHoldingOnboarding as preservedWrite} from '@/lib/holding-onboarding-write';
import {getHoldingOnboardingOptions} from '@/db/queries/holding-onboarding';
import {isAlignedBackendSourceSelected} from './selection';
export type {HoldingOnboardingActionState as SharedHoldingOnboardingActionState} from '../holding-onboarding';

// Default preserves the accepted writer. Aligned source remains inside the
// existing isolated local synthetic gate, never enabled by request parameters.
export async function writeSessionHoldingOnboarding(data:FormData) {
  await isAlignedBackendSourceSelected();
  return preservedWrite(data);
}
// This owner-filtered query is byte-identical in candidate and baseline.
export const getSharedHoldingOnboardingOptions = getHoldingOnboardingOptions;
