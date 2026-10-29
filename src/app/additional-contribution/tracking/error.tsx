'use client';
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
export default function TrackingError({ reset }: { reset: () => void }) {
  return <main className="varda-secondary-page"><RecoveryNotice kind="retry" onRetry={reset} details="저장한 배분안을 읽지 못했습니다. 기록을 빈 목록으로 대신 표시하지 않습니다." /></main>;
}
