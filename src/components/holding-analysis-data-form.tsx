"use client";

import { useActionFormReset } from "@/components/cairn-ui/client";

import { ManagementText } from "@/components/i18n/management-text";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/locale-provider";


import { prepareHoldingAnalysisData, readHoldingAnalysisProgress } from "@/app/portfolio/holdings/actions";
import type {
  HoldingAnalysisDataPreparationActionState,
  HoldingAnalysisDataReadiness,
} from "@/lib/holding-analysis-data-readiness";
import { Button as CairnButton, Form as CairnForm , Status as CairnStatus } from "@/components/cairn-ui";


const INITIAL_STATE: HoldingAnalysisDataPreparationActionState = Object.freeze({
  status: "idle",
  message: null,
});

export function HoldingAnalysisDataForm({
  holdingId,
  readiness: initialReadiness,
}: {
  holdingId: string;
  readiness: HoldingAnalysisDataReadiness | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [progress, setProgress] = useState<Awaited<ReturnType<typeof readHoldingAnalysisProgress>>>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refreshedCompletion = useRef<unknown>(null);
  const readiness = progress?.readiness ?? initialReadiness;
  const [state, action, pending] = useActionState(
    prepareHoldingAnalysisData,
    INITIAL_STATE,
  );
  const {formRef: actionFormRef, onReset: actionFormOnReset} = useActionFormReset(state);
  const messageId = `holding-analysis-data-${holdingId}`;
  useEffect(() => {
    if (!initialReadiness || initialReadiness.state === 'unsupported') return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, polls = 0, wasActive = state.status === 'queued';
    async function poll() {
      if (disposed) return;
      try {
        const result = await readHoldingAnalysisProgress(holdingId);
        if (disposed) return;
        setReadFailed(!result);
        if (!result) return;
        setProgress(result);
        const active = result.collection.state === 'pending' || result.collection.state === 'running';
        if (active && ++polls < 18) { wasActive = true; timer = setTimeout(poll, 10000); }
        else if (wasActive && !active && refreshedCompletion.current !== state) {
          refreshedCompletion.current = state;
          router.refresh();
        }
      } catch { if (!disposed) setReadFailed(true); }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [holdingId, initialReadiness, state, attempt, router]);
  const collection = progress?.collection;
  const collectionLabel = collection?.state === 'pending' ? t('수집 대기', 'Queued') : collection?.state === 'running' ? t('가격 수집 중', 'Collecting prices') : collection?.state === 'blocked' ? t('가격 출처 확인 필요 · 서비스에서 확인해야 해요', 'Conflicting price sources · Service review required') : collection?.state === 'failed' ? t('수집 실패 · 다시 요청 가능', 'Collection failed · Retry available') : collection?.state === 'done' ? t('가격 수집 완료', 'Price collection complete') : null;

  if (!readiness) {
    return <p className="text-xs text-[var(--warning)]"><ManagementText>{"상태 확인 불가"}</ManagementText></p>;
  }
  const needsOnlyFx = readiness.reason !== 'latest_close_stale' && readiness.trendReady && readiness.missingInputs?.length === 1 && readiness.missingInputs[0] === 'historical_fx';

  return (
    <div className="min-w-[190px] text-xs text-[var(--muted)]">
      <p className="font-semibold text-[var(--ink)]">
        {readinessLabel(readiness, locale === 'en')}
      </p>
      {readiness.state !== "unsupported" && readiness.state !== "blocked" ? (
        <>
          <p className="mt-1 tabular-nums"><ManagementText>{"가격"}</ManagementText>{readiness.observationCount}<ManagementText>{"일"}</ManagementText><ManagementText>{readiness.latestSourceDate
              ? ` · 최신 ${readiness.latestSourceDate}`
              : ""}</ManagementText>
          </p>
          <p className="mt-1">{t('기본 가격·환율 이력', 'Basic price and FX history')} {readiness.simulationReady ? t('확인됨', 'verified') : t('자료 필요', 'incomplete')}{' · '}
            {t('추세 이력', 'Trend history')} {readiness.trendReady ? t('확인됨', 'verified') : t('자료 필요', 'incomplete')}
          </p>
          {readiness.state === 'ready' && <p className="mt-1">{t('선택한 분석의 기간·공통 날짜 등 조건은 분석 화면에서 확인해 주세요.', 'The analysis screen checks its date range and shared observations.')}</p>}
        </>
      ) : null}
      {readiness.canPrepare && !needsOnlyFx ? (
        <CairnForm action={action} className="mt-2" onReset={actionFormOnReset} ref={actionFormRef}>
          <input name="holdingId" type="hidden" value={holdingId} />
          <CairnButton variant="primary"
            aria-describedby={messageId}
            className="rounded-md border border-[var(--faint)] bg-white px-2.5 py-1.5 font-semibold text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending || collection?.state === "pending" || collection?.state === "running" || collection?.state === "blocked"}
            type="submit"
          >
            <ManagementText>{pending ? "가격 확인 중" : "과거 가격 준비"}</ManagementText>
          </CairnButton>
        </CairnForm>
      ) : null}
      <CairnStatus as="p" tone={state.status === "success" ? "success" : state.message ? "warning" : "neutral"}
        aria-live="polite"
        className={[
          "mt-1 min-h-4 leading-5",
          state.status === "success" || state.status === "already_ready"
            ? "text-[var(--brand)]"
            : "text-[var(--warning)]",
        ].join(" ")}
        id={messageId}
      >
        <ManagementText>{collectionLabel ? `${collectionLabel} · ${collection?.completed}/${collection?.total}` : state.message}</ManagementText>
      </CairnStatus>
      {readFailed && <p role="status">{t('수집 상태를 확인하지 못했어요.', 'Unable to check collection status.')}</p>}
      {(readFailed || collection?.state === 'pending' || collection?.state === 'running') && <CairnButton type="button" variant="ghost" onClick={() => setAttempt(value => value + 1)}>{t('상태 다시 확인', 'Check status')}</CairnButton>}
      {!!readiness.missingInputs?.length && <details className="mt-2"><summary>{t('더 필요한 자료', 'Missing evidence')}</summary>
        {readiness.missingInputs.includes('prices') && <p>{t('공통 날짜의 종가가 부족해요. 과거 가격 준비를 요청해 주세요.', 'Closing prices are missing. Request historical prices.')}</p>}
        {readiness.missingInputs.includes('adjusted_prices') && <p>{t('수정주가가 부족해요. 과거 가격 수집 결과를 확인해 주세요.', 'Adjusted prices are missing. Check the historical collection result.')}</p>}
        {readiness.missingInputs.includes('historical_fx') && <p>{t('해당 날짜의 환율은 서비스에서 보완해야 해요. 종목 가격 수집으로 채울 수 없으며 현재 환율로 대신 계산하지 않아요.', 'Dated FX needs service-side repair. Collecting stock prices cannot supply it, and current FX is not substituted.')}</p>}
      </details>}
    </div>
  );
}

function readinessLabel(readiness: HoldingAnalysisDataReadiness, english: boolean) {
  if (readiness.state === "ready") return english ? 'Instrument history prepared' : '종목 이력 준비됨';
  if (readiness.state === "missing") return english ? 'No historical prices' : "과거 가격 없음";
  if (readiness.state === "limited") {
    return readiness.reason === "latest_close_stale"
      ? english ? 'Recent prices needed' : "최신 가격 보완 필요"
      : english ? 'Some history is missing' : "분석 자료 보완 필요";
  }
  if (readiness.reason === "manual_history_required") {
    return english ? 'Uses dated manual valuations' : "수동 평가 기록 사용";
  }
  if (readiness.reason === "managed_sleeve_excluded") {
    return english ? 'Excluded from lab and simulation' : "투자랩·시뮬레이션 제외";
  }
  if (readiness.reason === 'historical_evidence_conflict') return english ? 'Price evidence needs service review' : '가격 자료 확인 필요 · 서비스에서 확인';
  if (readiness.state === "blocked") return english ? 'Analysis scope needs review' : "분석 범위 확인 필요";
  return english ? 'Automatic price preparation unsupported' : "자동 가격 준비 미지원";
}
