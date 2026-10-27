"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSimulationExecution, listSimulationExecutions } from "@/app/simulation/storage-actions";
import type { SimulationStorageError, StoredSimulationExecution } from "@/lib/simulation-storage-management";
import { useSimulationText } from "./simulation-text";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import styles from "./simulation-storage-manager.module.css";

export function SimulationStorageManager() {
  const t = useSimulationText();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className={styles.manager} data-simulation-storage-manager>
    <div className={styles.actions}>
      <PresentationDialog label="보관 실행 관리" labelEn="Manage stored runs" title="보관 중인 시뮬레이션" titleEn="Stored simulations" mountOnOpen>
        <StoredExecutionList />
      </PresentationDialog>
      <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{t("다시 시도", "Retry")}</button>
    </div>
  </div>;
}

function StoredExecutionList() {
  const t = useSimulationText();
  const router = useRouter();
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<StoredSimulationExecution[] | null>(null);
  const [error, setError] = useState<SimulationStorageError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  // PresentationDialog mounts this child only after the user opens it. No
  // storage request or background mutation happens merely by viewing a chart.
  useEffect(() => {
    let active = true;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await listSimulationExecutions();
        if (!active) return;
        if (result.ok) setRows(result.executions);
        else setError(result.error);
      } catch { if (active) setError("unavailable"); }
      finally { busy.current = false; }
    });
    return () => { active = false; };
  }, []);

  function load() {
    if (busy.current) return;
    busy.current = true;
    setError(null); setSelected(null); setDeleted(false); setRows(null);
    startTransition(async () => {
      try {
        const result = await listSimulationExecutions();
        if (result.ok) setRows(result.executions);
        else setError(result.error);
      } catch { setError("unavailable"); }
      finally { busy.current = false; }
    });
  }

  function remove(executionId: string) {
    if (busy.current) return;
    busy.current = true; setError(null);
    startTransition(async () => {
      try {
        const result = await deleteSimulationExecution(executionId);
        if (!result.ok) { setError(result.error); return; }
        setRows(current => current?.filter(row => row.id !== executionId) ?? null);
        setSelected(null); setDeleted(true);
        // Refresh the current scope/model rather than navigating or replaying a
        // different run. The normal SQL gates still decide whether it can save.
        router.refresh();
      } catch { setError("unavailable"); }
      finally { busy.current = false; }
    });
  }

  function errorMessage(value: SimulationStorageError) {
    if (value === "authentication_required") return t("로그인한 뒤 다시 열어 주세요.", "Sign in and open this again.");
    if (value === "disabled") return t("지금은 경로 상세를 관리할 수 없어요.", "Path storage is not available right now.");
    if (value === "not_found") return t("이미 삭제되었거나 더 이상 보관되지 않은 실행입니다.", "This execution has already been deleted or is no longer stored.");
    return t("보관 실행을 확인하지 못했어요. 다시 시도해 주세요.", "Stored executions could not be checked. Please retry.");
  }

  return <section className={styles.list} aria-label={t("보관 중인 시뮬레이션", "Stored simulations")} aria-busy={pending}>
      <p className={styles.caption}>{t("최근 완료된 실행 2개를 자동으로 보관합니다. 새 저장이 끝나면 가장 오래된 실행을 교체하며, 저장 중에는 기존 결과를 유지합니다.", "The two latest completed runs are retained automatically. A new run replaces the oldest only after saving successfully; previous results stay available during upload.")}</p>
      {pending && rows === null ? <p role="status">{t("보관 실행을 확인하는 중…", "Checking stored runs…")}</p> : null}
      {error ? <div role="alert"><p>{errorMessage(error)}</p><button type="button" disabled={pending} onClick={load}>{t("목록 다시 확인", "Reload list")}</button></div> : null}
      {rows?.length === 0 && !deleted ? <p>{t("보관 중인 실행이 없어요. 잠시 후 다시 시도해 주세요.", "No stored runs. Please retry shortly.")}</p> : null}
      {rows?.map(row => <div key={row.id} className={styles.row}>
        <div><strong>{row.model === "economic" ? t("경제지표 경로", "Economic paths") : t("과거 수익률 경로", "Historical paths")} · {row.horizon}{t("단계", " steps")}</strong>
          <time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString(t("ko-KR", "en-US"), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
          {row.state === "creating" ? <span className={styles.caption}>{t("저장 중", "Saving")}</span> : null}
        </div>
        <button type="button" disabled={pending} onClick={() => setSelected(row.id)} aria-label={t(`${row.horizon}단계 실행 삭제 선택`, `Select ${row.horizon}-step run for deletion`)}>{t("삭제", "Delete")}</button>
        {selected === row.id ? <div className={styles.confirm}>
          <p>{t("이 실행의 경로 설명을 삭제할까요?", "Delete this run’s path details?")}</p>
          <div className={styles.actions}><button type="button" disabled={pending} onClick={() => remove(row.id)}>{t("삭제하고 다시 시도", "Delete and retry")}</button><button type="button" disabled={pending} onClick={() => setSelected(null)}>{t("취소", "Cancel")}</button></div>
        </div> : null}
      </div>)}
      {deleted ? <p role="status">{t("삭제했어요. 현재 실행을 다시 준비합니다.", "Deleted. Preparing the current run again.")}</p> : null}
    </section>;
}
