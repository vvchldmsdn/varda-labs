"use client";
import { HoldingAnalysisRecovery } from "@/components/holding-analysis-recovery";
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { simulationRecoveryReasons } from '@/lib/cairn-v2/simulation-recovery';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Select as CairnSelect } from "@/components/cairn-ui";


import { useLayoutEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { betaHref } from '@/lib/cairn-v2/navigation';
import { BetaShell } from "./beta-shell";
import { useBetaContext } from "./use-beta-context";
import { useBetaReadFreshness, useBetaExistingCrudAvailable } from "./beta-provider";
import { blankDomainView } from "@/lib/cairn-v2/read-contract";
import { blankSimulation, simulationKey, SIMULATION_RESEARCH_HORIZON_POLICY, type SimulationRead } from "@/lib/cairn-v2/simulation-contract";
import { EmptyState } from "./ui/molecules";
import SimulationResultDetail from "./simulation-result-detail";
import styles from "./simulation.module.css";

export function BetaSimulation({ read }: { read: SimulationRead }) {
  const [context, setContext] = useBetaContext(read.context);
  const freshness = useBetaReadFreshness();
  const router = useRouter();
  const crudAvailable = useBetaExistingCrudAvailable();
  const [edited, setEdited] = useState<{key: string; horizon: string} | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(read.model?.execution.status !== "ready");
  const [running, startRun] = useTransition();
  const key = simulationKey(context);
  const appliedHorizon = typeof context.horizon === "string" ? context.horizon : SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon;
  const horizonLabel = edited?.key === key ? edited.horizon : appliedHorizon;
  const observed = freshness?.observed;
  const epoch = freshness?.epoch;
  useLayoutEffect(() => { observed?.(read.readReceipt, read.readEpoch); }, [read.readReceipt, read.readEpoch, observed, epoch]);
  const visible = running || key !== simulationKey(read.context) || freshness?.store.blocked(read.readReceipt, read.readEpoch)
    ? blankSimulation(context, "loading", "연구 결과를 준비하고 있습니다.")
    : edited?.key === key ? blankSimulation(context, "idle", "조건을 바꿨어요.") : read;
  const shell = blankDomainView(visible.state === "ready" || visible.state === "partial" ? visible.state : visible.state === "unauthorized" ? "unauthorized" : "loading", visible.message);
  shell.domain!.scopes = read.scopes;
  const ready = visible.model?.execution.status === "ready";

  return <BetaShell context={context} setContext={next => { setEdited(null); setContext({ ...next, run: undefined }); }}
    readView={shell} workspace="simulation" originalPath="/simulation">
    <section className={styles.workspace} data-simulation-state={visible.state} data-result-identity={visible.resultIdentity}>
      <p className={styles.intro}>현재 구성을 유지한 가상 경로 · KRW 기준</p>
      <details className={styles.settings} open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
      <summary>계산 조건<span>거래 관측 {horizonLabel}회</span></summary>
      <CairnForm key={key} className={styles.conditions} aria-label="연구 조건" aria-describedby="simulation-condition-help"
        onChange={event => setEdited({key, horizon: String(new FormData(event.currentTarget).get("horizon"))})}
        onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setEdited(null);
          const next = { ...context, horizon: String(data.get("horizon")), end: String(data.get("end")) || undefined, run: "1" };
          startRun(() => { if (simulationKey(next) === key) router.refresh(); else setContext(next); });
        }}>
        <CairnField>살펴볼 기간
          <CairnSelect disabled={visible.state === "loading"} name="horizon" aria-label="연구 기간"
            defaultValue={typeof context.horizon === "string" ? context.horizon : String(SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon)}>
            {SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons.map(horizon =>
              <option key={horizon} value={horizon}>거래 관측 {horizon}회</option>)}
          </CairnSelect>
        </CairnField>
        <CairnField>기준일 · 선택
          <CairnInput disabled={visible.state === "loading"} type="date" name="end" aria-label="저장 관측 기준일"
            defaultValue={typeof context.end === "string" ? context.end : ""} />
        </CairnField>
        <CairnButton variant="primary" type="submit" disabled={visible.state === "loading" || visible.state === "unauthorized"}>{running ? "연구 확인 중…" : "연구 실행"}</CairnButton>
        <p id="simulation-condition-help">기준일을 비우면 종목들의 공통 자료가 있는 최신 날짜를 써요.</p>
      </CairnForm>
      </details>
      {ready ? <div className={styles.result}><SimulationResultDetail read={visible} context={context} heading={false} /></div> :
        visible.state === "idle" ? (edited?.key === key && <p role="status">조건을 변경했어요. 연구를 실행하면 새 결과를 볼 수 있어요.</p>) :
        <EmptyState title={visible.state === "loading" ? "연구 결과를 준비하고 있습니다" : "연구를 완료할 수 없습니다"}
          description={visible.model?.historyRecovery?'최근 조정 종가에 확인이 필요한 날짜가 있습니다. 요청한 기준일은 바꾸지 않았습니다.':visible.message}
          action={visible.model?.historyRecovery?<a href={betaHref('/beta/simulation',{...context,end:visible.model.historyRecovery.verifiedEndServiceDate,run:'1'})}>검증된 {visible.model.historyRecovery.verifiedEndServiceDate} 기준으로 보기 ↗</a>:undefined} />}
      {!ready && crudAvailable && visible === read && !['loading','unauthorized','invalid'].includes(visible.state) && <HoldingAnalysisRecovery key={`${context.scope}:${read.readReceipt}:${read.readEpoch}`} scope={context.scope} />}
      {!ready && crudAvailable && ['unavailable','partial','blocked'].includes(visible.state) && <RecoveryNotice beta source="current" scope={context.scope} reasons={simulationRecoveryReasons(visible.model)} kind={!visible.model ? 'retry' : undefined} />}
    </section>
  </BetaShell>;
}
