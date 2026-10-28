'use client';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { useSyncExternalStore, type ReactNode, type ComponentProps } from 'react';
import { useI18n } from '@/components/i18n/locale-provider';
import { Button } from '@/components/cairn-ui';
import { recoveryReturnHref, safeRecoveryUrl, carryRecoveryFragment, RECOVERY_FRAGMENT } from '@/lib/recovery-navigation';
import styles from './recovery.module.css';

const subscribe = (notify: () => void) => { window.addEventListener('hashchange', notify); window.addEventListener('popstate', notify); return () => { window.removeEventListener('hashchange', notify); window.removeEventListener('popstate', notify); }; };
const snapshot = () => location.hash;
function useReturnHref() {
  // Route reads also re-evaluate the fragment after App Router navigation.
  usePathname(); useSearchParams();
  return recoveryReturnHref(useSyncExternalStore(subscribe, snapshot, () => ''));
}
function freshReturnHref(href: string) {
  const url = new URL(href, location.origin);
  if (url.pathname.startsWith('/beta') && url.searchParams.get('mode') === 'domain') url.searchParams.set('_betaRead', crypto.randomUUID());
  return url.pathname + url.search + url.hash;
}
export function RecoveryReturn() {
  const href = useReturnHref(), router = useRouter(), { t } = useI18n();
  if (!href) return null;
  function back() {
    router.push(freshReturnHref(href!));
  }
  return <aside className={styles.returnBar} data-recovery-return aria-label={t('이전 작업으로 돌아가기', 'Return to your task')}>
    <div><strong>{t('확인 후 이전 작업을 이어가세요', 'Continue your previous task')}</strong><p>{t('돌아가면 입력한 조건으로 최신 자료를 확인합니다. 수정한 내용은 이 화면에서 먼저 저장해 주세요.', 'Return with your inputs and fresh data. Save any edits on this page before leaving.')}</p></div>
    <Button type="button" variant="primary" onClick={back}>{t('입력 유지하고 돌아가기', 'Return with my inputs')}</Button>
  </aside>;
}
export function RecoveryBackLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const recovered = useReturnHref(), router = useRouter();
  return <Link prefetch={false} href={recovered ?? href} className={className} onClick={event => {
    if (!recovered || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); router.push(freshReturnHref(recovered));
  }}>{children}</Link>;
}
/** Keep a task's return address through the management steps needed to fix it. */
export function RecoveryJourneyLink({ href, ...props }: ComponentProps<typeof Link>) {
  const recovered = useReturnHref();
  const destination = recovered && typeof href === 'string' && safeRecoveryUrl(href) ? carryRecoveryFragment(href, RECOVERY_FRAGMENT + encodeURIComponent(recovered)) : href;
  return <Link {...props} href={destination} />;
}
