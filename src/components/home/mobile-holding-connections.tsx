"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import type { buildHoldingConnectionGraph } from "@/lib/holding-connection-graph";
import styles from "./mobile-holding-connections.module.css";

type Graph = ReturnType<typeof buildHoldingConnectionGraph>;

export function MobileHoldingConnections({ graph }: { graph: Graph }) {
  const { t } = useI18n();
  function pair(edge: Graph["edges"][number]) {
    const left = graph.nodes[edge.leftIndex];
    const right = graph.nodes[edge.rightIndex];
    return <li key={edge.key} className={styles.pair}>
      <div className={styles.names}><span>{left.name}</span><span className={styles.connector} data-opposite={edge.correlation < 0} aria-hidden="true"><i /><i /></span><span>{right.name}</span></div>
      <div className={styles.metric}><span>{edge.correlation >= 0 ? t("함께 움직이는 경향", "Tend to move together") : t("반대로 움직이는 경향", "Tend to move apart")}</span>
        <strong data-opposite={edge.correlation < 0}>{edge.correlation > 0 ? "+" : ""}{edge.correlation.toFixed(2)}</strong><small>{t(`${edge.observations}일 비교`, `${edge.observations} shared days`)}</small></div>
    </li>;
  }
  return <div className={styles.mobile}>
    <p className={styles.intro}>{t("최근 움직임이 연결된 종목", "Holdings with related recent moves")}</p>
    <p className={styles.caption}>{t(`기록이 있는 종목 중 비중 상위 ${graph.nodes.length}종목에서 관계가 강한 조합부터 표시합니다.`, `Strongest relationships among the ${graph.nodes.length} largest holdings with recorded history.`)}</p>
    <ol className={styles.pairs}>{graph.edges.slice(0, 3).map(pair)}</ol>
    {graph.edges.length > 3 ? <details className={styles.more}><summary>{t(`다른 연결 ${graph.edges.length - 3}개 보기`, `Show ${graph.edges.length - 3} more relationships`)}</summary><ol className={styles.pairs}>{graph.edges.slice(3).map(pair)}</ol></details> : null}
    <p className={styles.note}>{t("+1에 가까울수록 함께, −1에 가까울수록 반대로 움직였습니다. ETF 내부 종목의 중복이나 앞으로의 움직임을 뜻하지 않습니다.", "Closer to +1 means they moved together; closer to −1 means they moved apart. This does not measure ETF holdings overlap or predict future moves.")}</p>
  </div>;
}
