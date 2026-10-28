export type CardKind =
  "value" | "today" | "history" | "heatmap" | "structure" | "contribution" | "simulation" | "drift";

export const cardTitles: Record<CardKind, string> = {
  value: "현재 평가액",
  today: "오늘의 변동",
  history: "히스토리",
  heatmap: "종목 흐름",
  structure: "포트 구조",
  contribution: "추가 투자",
  simulation: "시뮬레이션",
  drift: "목표 편차",
};

export const cardOriginals: Record<CardKind, string> = {
  value: "/",
  today: "/today",
  history: "/history",
  heatmap: "/today",
  structure: "/portfolio/structure",
  contribution: "/additional-contribution",
  simulation: "/simulation",
  drift: "/portfolio/targets",
};
