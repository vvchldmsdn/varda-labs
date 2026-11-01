'use client';

import { Status } from '@/components/cairn-ui';
import { useI18n } from '@/components/i18n/locale-provider';

export function DraftPreservationNotice({ visible }: { visible: boolean }) {
  const { t } = useI18n();
  return visible ? <Status tone="warning">{t('입력은 현재 화면에만 유지돼요. 이동하거나 새로고침하면 최근 변경이 사라질 수 있어요.', 'These edits are kept only on this screen. Leaving or refreshing may discard the latest changes.')}</Status> : null;
}
