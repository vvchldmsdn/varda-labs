'use client';
import { useRef, useState } from 'react';
import { readHoldingAnalysisScope } from '@/app/portfolio/holdings/actions';
import { HoldingAnalysisDataPanelView } from '@/components/holding-analysis-data-panel';
import { useI18n } from '@/components/i18n/locale-provider';
import { Button } from '@/components/cairn-ui';

export function HoldingAnalysisRecovery({ scope }: { scope: string }) {
  const { t } = useI18n();
  const [read, setRead] = useState<{scope: string; result: Awaited<ReturnType<typeof readHoldingAnalysisScope>>} | null>(null);
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  async function load() {
    const generation = ++request.current; setPending(true);
    try { const result = await readHoldingAnalysisScope(scope); if (generation === request.current) setRead({scope, result}); }
    catch { if (generation === request.current) setRead({scope, result:{state:'unavailable'}}); }
    finally { if (generation === request.current) setPending(false); }
  }
  const current = read?.scope === scope ? read.result : null;
  return <details className="border-y border-[var(--line)] py-4" onToggle={event => { if (event.currentTarget.open && !current && !pending) void load(); }}>
    <summary>{t('가격·환율 준비 상태', 'Price and FX readiness')}</summary>
    {pending ? <p role="status">{t('자료 확인 중…', 'Checking data…')}</p> : current ? <><HoldingAnalysisDataPanelView result={current} />{current.state === 'ready' && (current.entries.length === 0 ? <p>{t('확인할 보유종목이 없습니다.', 'There are no holdings to check.')}</p> : current.entries.every(entry => entry.readiness.state === 'ready') ? <p>{t('종목별 기본 이력이 준비됐어요. 선택한 분석의 기간·공통 날짜 등 조건은 분석 화면에서 확인해 주세요.', 'Basic instrument history is prepared. The analysis screen checks its date range and shared observations.')}</p> : null)}</> : null}
    <Button variant="ghost" type="button" disabled={pending} onClick={load}>{t('다시 확인', 'Check again')}</Button>
  </details>;
}
