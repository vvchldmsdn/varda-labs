export type SnapshotProgress = "failed" | "blocked" | "running" | "pending" | "completed" | "unknown";
export function summarizeSnapshotProgress(rows: readonly {status: string | null}[]): SnapshotProgress {
  if (!rows.length) return "unknown";
  for (const state of ["failed", "blocked", "running", "pending"] as const) {
    if (rows.some(row => row.status === state)) return state;
  }
  return rows.every(row => row.status === "completed") ? "completed" : "unknown";
}
export function snapshotProgressMessage(state: SnapshotProgress) {
  const messages = {
    failed: {ko: "07시 기준 기록 저장에 실패했어요. 복구 후 오늘 변동을 확인할 수 있어요.", en: "The 07:00 baseline could not be saved. Today's change will be available after recovery."},
    blocked: {ko: "07시 기준 가격·보유 근거가 부족해 저장을 보류했어요.", en: "The 07:00 baseline is on hold because price or position evidence is missing."},
    running: {ko: "07시 기준 기록을 저장하고 있어요.", en: "The 07:00 baseline is being saved."},
    pending: {ko: "07시 기준 기록의 저장 순서를 기다리고 있어요.", en: "The 07:00 baseline is queued."},
    completed: {ko: "기준 기록과 현재 자산의 연결을 확인해야 해요.", en: "The saved baseline needs to be matched to the current portfolio."},
    unknown: {ko: "07시 기준 기록이 없어 오늘 변동을 계산할 수 없어요.", en: "Today's change needs a 07:00 baseline."},
  };
  return messages[state];
}