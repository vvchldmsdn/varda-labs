import type { ReactNode } from 'react';
import styles from './action-row.module.css';

/** Callers own destinations, permissions and state; this component only presents them. */
export function ActionGroup({ label, children, className, layout = 'cards' }: { label: string; children: ReactNode; className?: string; layout?: 'cards' | 'list' }) {
  return <nav aria-label={label} className={[styles.group, className].filter(Boolean).join(' ')} data-cairn-actions data-layout={layout}>{children}</nav>;
}

/** Place inside a link or button in ActionGroup. Keep the native interaction element. */
export function ActionContent({ title, description, icon }: { title: ReactNode; description?: ReactNode; icon?: ReactNode }) {
  return <>
    {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
    <span className={styles.copy}><strong>{title}</strong>{description && <span>{description}</span>}</span>
    <svg className={styles.arrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
  </>;
}
