import Link from 'next/link';
import { resolveFrontendChoice, type FrontendChoiceRequest } from '@/lib/cairn-v2/frontend-choice';
import styles from './frontend-choice.module.css';

export type FrontendChoiceProps = FrontendChoiceRequest & { enabled?: boolean };

/** Disabled unless the server explicitly enables this local transition surface.
 * It never changes the Preview policy or authorizes the destination's actions. */
export function FrontendChoice({ enabled = false, ...request }: FrontendChoiceProps) {
  if (!enabled) return null;
  const choice = resolveFrontendChoice(request);
  return <nav className={styles.choice} aria-label="기존 화면과 새 화면 선택" data-frontend-choice-state={choice.state}>
    {choice.state === 'ready' ? <>
      {request.current === 'original' ? <span className={styles.current} aria-current="page">기존 화면</span> : choice.originalHref ? <a href={choice.originalHref}>계속 기존 화면</a> : <span aria-disabled="true">기존 화면 미지원</span>}
      {request.current === 'beta' ? <span className={styles.current} aria-current="page">새 화면</span> : choice.betaHref ? <Link prefetch={false} href={choice.betaHref}>새 화면으로</Link> : <span aria-disabled="true">새 화면 미연결</span>}
    </> : <p role="status">{choice.message}</p>}
    {choice.notes.map(note => <p key={note}>{note}</p>)}
  </nav>;
}
