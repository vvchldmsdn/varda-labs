import { SimulationText } from "./simulation-text";
import styles from "./simulation-loading.module.css";

export type SimulationLoadingPhase = "page" | "paths" | "weights" | "validation" | "evidence";

const copy = {
  page: ["시뮬레이션을 준비하고 있습니다", "Preparing your simulation", "보유 종목과 계산에 필요한 자료를 확인합니다.", "Checking your holdings and the data needed for this model."],
  paths: ["1,000개의 가능성을 계산하고 있습니다", "Calculating 1,000 possible paths", "선택한 조건으로 경로와 수익률 분포를 계산합니다. 준비되면 바로 표시합니다.", "Calculating paths and their return distribution for your settings. Results appear as soon as they are ready."],
  weights: ["같은 경로에서 비중을 비교하고 있습니다", "Comparing weights on the same paths", "1,000개 경로에서 후보를 탐색하고 별도 확인 경로로 비교합니다.", "Searching candidates and checking them on a separate split of the 1,000 paths."],
  validation: ["과거 구간의 결과를 검증하고 있습니다", "Checking outcomes across historical periods", "각 학습 구간 이후의 실제 결과와 비교합니다. 이 과정은 조금 더 걸릴 수 있습니다.", "Comparing each fitted period with later observed outcomes. This step can take a little longer."],
  evidence: ["계산 근거를 불러오고 있습니다", "Loading the model evidence", "포함 종목, 관측 날짜와 데이터 준비 상태를 확인합니다.", "Checking included holdings, observation dates and input readiness."],
} as const;

/** Indeterminate feedback: no estimated percentage or invented completed steps. */
export function SimulationLoading({ phase = "paths", compact = false }: { phase?: SimulationLoadingPhase; compact?: boolean }) {
  const [title, titleEn, description, descriptionEn] = copy[phase];
  return <section className={`${styles.loading} ${compact ? styles.compact : ""}`} role="status" aria-live="polite" data-simulation-loading={phase}>
    <div className={styles.heading}><span className={styles.spinner} aria-hidden="true" /><p><SimulationText ko={title} en={titleEn} /></p></div>
    <p className={styles.description}><SimulationText ko={description} en={descriptionEn} /></p>
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.metrics}><i /><i /><i /></div>
      <svg viewBox="0 0 600 170" preserveAspectRatio="none">
        <path d="M0 100H600" className={styles.axis} />
        <g className={styles.traces}>
          <path d="M0 100L50 97L100 85L150 91L200 69L250 73L300 51L350 58L400 39L450 49L500 29L550 34L600 16" />
          <path d="M0 100L50 105L100 98L150 109L200 95L250 111L300 93L350 103L400 88L450 104L500 93L550 101L600 84" />
          <path d="M0 100L50 107L100 110L150 103L200 124L250 117L300 132L350 123L400 144L450 136L500 153L550 141L600 162" />
        </g>
      </svg>
    </div>
    <span className={styles.footnote}><SimulationText ko="완료된 결과만 표시합니다." en="Only completed results are shown." /></span>
  </section>;
}
