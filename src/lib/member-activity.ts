export const ACTIVITY_FEATURES = { home: "홈", today: "오늘 변동", structure: "포트 구조", contribution: "추가투입", lab: "투자 랩", simulation: "시뮬레이션", history: "히스토리", manage: "자산 관리", plans: "저장한 계획", input: "간편 입력" } as const;
export type ActivityFeature = keyof typeof ACTIVITY_FEATURES;
export const ACTIVITY_RETENTION_DAYS = 90;
export function activityFeature(path: string): ActivityFeature | null {
  if (path === "/") return "home";
  const exact: Record<string, ActivityFeature> = { "/today": "today", "/portfolio/structure": "structure", "/portfolio/risk": "structure", "/additional-contribution": "contribution", "/investment-lab": "lab", "/simulation": "simulation", "/history": "history", "/plans": "plans", "/try": "input", "/try/analyze": "input", "/portfolio/onboarding": "input" };
  if (exact[path]) return exact[path];
  return /^\/portfolio\/(accounts|holdings|manage|groups|targets|events|position-snapshots|portfolio-snapshots)(\/|$)/.test(path) ? "manage" : null;
}
export function parseActivityBody(value: unknown): ActivityFeature | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) return null;
  const feature = (value as { feature?: unknown }).feature;
  return typeof feature === "string" && Object.hasOwn(ACTIVITY_FEATURES, feature) ? feature as ActivityFeature : null;
}
