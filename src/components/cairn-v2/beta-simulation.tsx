"use client";
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Select as CairnSelect } from "@/components/cairn-ui";


import { useLayoutEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { betaHref } from '@/lib/cairn-v2/navigation';
import { BetaShell } from "./beta-shell";
import { useBetaContext } from "./use-beta-context";
import { useBetaReadFreshness, useBetaExistingCrudAvailable } from "./beta-provider";
import { blankDomainView } from "@/lib/cairn-v2/read-contract";
import { blankSimulation, simulationKey, SIMULATION_RESEARCH_HORIZON_POLICY, type SimulationRead } from "@/lib/cairn-v2/simulation-contract";
import { DetailHeader, EmptyState } from "./ui/molecules";
import { StatusPill } from "./ui/atoms";
import SimulationResultDetail from "./simulation-result-detail";
import styles from "./simulation.module.css";

export function BetaSimulation({ read }: { read: SimulationRead }) {
  const [context, setContext] = useBetaContext(read.context);
  const freshness = useBetaReadFreshness();
  const router = useRouter();
  const crudAvailable = useBetaExistingCrudAvailable();
  const [edited, setEdited] = useState<string | null>(null);
  const [running, startRun] = useTransition();
  const key = simulationKey(context);
  const observed = freshness?.observed;
  const epoch = freshness?.epoch;
  useLayoutEffect(() => { observed?.(read.readReceipt, read.readEpoch); }, [read.readReceipt, read.readEpoch, observed, epoch]);
  const visible = running || key !== simulationKey(read.context) || freshness?.store.blocked(read.readReceipt, read.readEpoch)
    ? blankSimulation(context, "loading", "연구 결과를 준비하고 있습니다.")
    : edited === key ? blankSimulation(context, "idle", "조건을 바꿨습니다. 연구 실행을 누르면 새 결과를 확인할 수 있습니다.") : read;
  const shell = blankDomainView(visible.state === "ready" || visible.state === "partial" ? visible.state : visible.state === "unauthorized" ? "unauthorized" : "loading", visible.message);
  shell.domain!.scopes = read.scopes;
  const ready = visible.model?.execution.status === "ready";

  return <BetaShell context={context} setContext={next => { setEdited(null); setContext({ ...next, run: undefined }); }}
    readView={shell} workspace="simulation" originalPath="/simulation">
    <section className={styles.workspace} data-simulation-state={visible.state} data-result-identity={visible.resultIdentity}>
      <DetailHeader title="현재 보유 연구" description="과거 수익률로 살펴보는 가상 경로"
        actions={<StatusPill>분석 기준 KRW</StatusPill>} />
      <CairnForm key={key} className={styles.conditions} aria-label="연구 조건" aria-describedby="simulation-condition-help"
        onChange={() => setEdited(key)}
        onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setEdited(null);
          const next = { ...context, horizon: String(data.get("horizon")), end: String(data.get("end")) || undefined, run: "1" };
          startRun(() => { if (simulationKey(next) === key) router.refresh(); else setContext(next); });
        }}>
        <CairnField>앞으로 살펴볼 기간
          <CairnSelect disabled={visible.state === "loading"} name="horizon" aria-label="연구 기간"
            defaultValue={typeof context.horizon === "string" ? context.horizon : String(SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon)}>
            {SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons.map(horizon =>
              <option key={horizon} value={horizon}>{horizon}개 관측 단계</option>)}
          </CairnSelect>
        </CairnField>
        <CairnField>과거 관측 기준일
          <CairnInput disabled={visible.state === "loading"} type="date" name="end" aria-label="저장 관측 기준일"
            defaultValue={typeof context.end === "string" ? context.end : ""} />
        </CairnField>
        <CairnButton variant="primary" type="submit" disabled={visible.state === "loading" || visible.state === "unauthorized"}>{running ? "연구 확인 중…" : "연구 실행"}</CairnButton>
        <p id="simulation-condition-help">기준일을 비우면 최신 공통 관측을 사용합니다. 관측 단계는 달력 날짜와 다릅니다.</p>
      </CairnForm>
      {ready ? <div className={styles.result}><SimulationResultDetail read={visible} context={context} heading={false} /></div> :
        <EmptyState title={visible.state === "loading" ? "연구 결과를 준비하고 있습니다" : visible.state === "idle" ? "조건을 확인하고 연구를 시작하세요" : "연구를 완료할 수 없습니다"}
          description={visible.model?.historyRecovery?'최근 조정 종가에 확인이 필요한 날짜가 있습니다. 요청한 기준일은 바꾸지 않았습니다.':visible.message}
          action={visible.model?.historyRecovery?<a href={betaHref('/beta/simulation',{...context,end:visible.model.historyRecovery.verifiedEndServiceDate,run:'1'})}>검증된 {visible.model.historyRecovery.verifiedEndServiceDate} 기준으로 보기 ↗</a>:undefined} />}
      {!ready && crudAvailable && ['unavailable','partial','blocked'].includes(visible.state) && <RecoveryNotice beta scope={context.scope} reasons={visible.model?.execution.reason ? [visible.model.execution.reason] : []} kind={!visible.model ? 'retry' : undefined} />}
    </section>
  </BetaShell>;
}
