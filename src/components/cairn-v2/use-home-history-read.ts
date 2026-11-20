'use client';

import { useEffect, useState } from 'react';
import type { BetaContext } from '@/lib/cairn-v2/navigation';
import { applyBetaHistory, type BetaView, type DomainRead } from '@/lib/cairn-v2/read-contract';
import { HISTORY_BINDING_HEADER, homeHistoryGeneration, homeHistoryRequest, matchesHomeHistory, type HomeHistoryRead } from '@/lib/cairn-v2/home-history-read';
import { startBoundedRead } from '@/lib/cairn-v2/bounded-read';

// Full evidence is demand-loaded once for this parent read only. A manual refresh,
// scope/currency change or owner/session change creates a different generation.
export function useHomeHistoryRead(base: BetaView, read: DomainRead | undefined, context: BetaContext, needed: boolean) {
  const key = homeHistoryGeneration(context, read);
  const [result, setResult] = useState<{ key: string; value?: HomeHistoryRead; error?: 'session' | 'read' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const eligible = read?.historyWindow === 'recent' && !!read.displayBinding && !!base.domain &&
    !['loading', 'unauthorized'].includes(base.domain.state);
  const active = result?.key === key ? result : null;
  const complete = !!active?.value;
  useEffect(() => {
    if (!eligible || !needed || complete || !read) return;
    let mounted = true;
    const request = startBoundedRead(async signal => {
        const response = await fetch(homeHistoryRequest(context, read), { credentials: 'same-origin', cache: 'no-store',
          signal, headers: { [HISTORY_BINDING_HEADER]: read.displayBinding! } });
        if ([401, 403, 409].includes(response.status) || response.ok && response.headers.get(HISTORY_BINDING_HEADER) !== read.displayBinding) {
          return { key, error: 'session' as const };
        }
        if (!response.ok) throw new Error('history_read_failed');
        const value: HomeHistoryRead = await response.json();
        if (!matchesHomeHistory(value, context, read)) throw new Error('history_read_mismatch');
        return { key, value };
    });
    void request.promise.then(value => { if (mounted) setResult(value); }, () => { if (mounted) setResult({ key, error: 'read' }); });
    return () => { mounted = false; request.cancel(); };
  // key captures every scope/currency/session/parent-receipt/epoch input.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eligible, needed, complete, attempt]);
  const retry = () => { setResult(null); setAttempt(value => value + 1); };
  if (!eligible) return { view: base, error: undefined, retry };
  if (active?.value) return { view: applyBetaHistory(base, active.value.history, context.currency).view, error: undefined, retry };
  if (!needed) return { view: base, error: undefined, retry };
  // Never label the recent subset as ALL or show old data while another scope loads.
  const view: BetaView = { ...base, history: [], domain: { ...base.domain!, historyRecords: [], recoveredReturn: null,
    historyState: active?.error ? 'unavailable' : 'loading', historyReadStatus: active?.error ? 'unavailable' : 'ready' } };
  return { view, error: active?.error, retry };
}
