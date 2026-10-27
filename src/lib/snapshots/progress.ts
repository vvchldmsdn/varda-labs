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
    failed: {ko: "일일 기준 기록 저장에 실패했어요. 복구 후 오늘 변동을 확인할 수 있어요.", en: "The daily baseline could not be saved. Today's change will be available after recovery."},
    blocked: {ko: "가격·환율 또는 보유 정보를 확인하지 못해 아직 저장되지 않았어요.", en: "The daily baseline is on hold because prices, FX or holdings could not be verified."},
    running: {ko: "일일 기준 기록을 저장하고 있어요.", en: "The daily baseline is being saved."},
    pending: {ko: "일일 기준 기록의 저장 순서를 기다리고 있어요.", en: "The daily baseline is queued."},
    completed: {ko: "기준 기록과 현재 자산의 연결을 확인해야 해요.", en: "The saved baseline needs to be matched to the current portfolio."},
    unknown: {ko: "일일 기준 기록이 없어 오늘 변동을 계산할 수 없어요.", en: "Today's change needs a daily baseline."},
  };
  return messages[state];
}