'use client';

import { useEffect, useState } from 'react';
import { Button, Status } from '@/components/cairn-ui';
import type { BetaContext } from '@/lib/cairn-v2/navigation';
import { homeSimulationRequest, matchesHomeSimulation, SIMULATION_BINDING_HEADER } from '@/lib/cairn-v2/home-simulation-read';
import type { SimulationRead } from '@/lib/cairn-v2/simulation-contract';
import { startBoundedRead } from '@/lib/cairn-v2/bounded-read';
import { useBetaReadFreshness } from './beta-provider';
import { HomeSimulationPending, HomeSimulationResult } from './home-simulation';

type Props = { context: BetaContext; binding: string; receipt?: string; epoch?: string };

// A new home read (scope/currency/manual refresh/session change) starts a new
// instance. Never retain a research result across its parent read generation.
export function LazyHomeSimulation(props: Props) {
  return <SimulationRequest key={JSON.stringify([homeSimulationRequest(props.context, props.epoch), props.binding, props.receipt])} {...props} />;
}

function SimulationRequest({ context, binding, receipt, epoch }: Props) {
  const freshness = useBetaReadFreshness();
  const [result, setResult] = useState<{ read: SimulationRead } | { error: 'session' | 'read' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const href = homeSimulationRequest(context, epoch);
  useEffect(() => {
    let active = true;
    const request = startBoundedRead(async signal => {
        const response = await fetch(href, { credentials: 'same-origin', cache: 'no-store', signal,
          headers: { [SIMULATION_BINDING_HEADER]: binding } });
        if ([401, 403, 409].includes(response.status) || response.ok && response.headers.get(SIMULATION_BINDING_HEADER) !== binding) {
          return { error: 'session' as const };
        }
        if (!response.ok) throw new Error('simulation_read_failed');
        const read: SimulationRead = await response.json();
        if (!matchesHomeSimulation(read, context, binding, epoch)) throw new Error('simulation_read_mismatch');
        return { read };
    });
    void request.promise.then(value => { if (active) setResult(value); }, () => { if (active) setResult({ error: 'read' }); });
    return () => { active = false; request.cancel(); };
  // Context is encoded in href; a parent read generation is encoded in the key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, binding, attempt]);

  if (freshness?.store.blocked(receipt, epoch) || !result) return <HomeSimulationPending detail />;
  if ('read' in result) return <HomeSimulationResult read={result.read} context={context} detail />;
  return <Status as="div" role="status">
    <p>{result.error === 'session' ? '계좌 연결이 바뀌었어요. 화면을 새로고침해 주세요.' : '시뮬레이션을 불러오지 못했어요.'}</p>
    <Button type="button" variant="secondary" onClick={() => {
      if (result.error === 'session') { window.location.reload(); return; }
      setResult(null); setAttempt(value => value + 1);
    }}>{result.error === 'session' ? '새로고침' : '다시 조회'}</Button>
  </Status>;
}
