'use client';
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
export default function PlanError({ reset }: { reset: () => void }) {
  return <main className="varda-secondary-page"><RecoveryNotice kind="retry" onRetry={reset} /></main>;
}
