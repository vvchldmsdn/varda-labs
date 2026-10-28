"use client";
import { Button, EmptyState } from '@/components/cairn-ui';
export default function ComparisonError({ reset }: { reset: () => void }) {
  return <EmptyState title="비교 근거를 불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요. 저장된 거래와 계획에는 영향이 없습니다." action={<Button onClick={reset}>다시 시도</Button>} />;
}
