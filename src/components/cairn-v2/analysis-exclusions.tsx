import { instrumentLabel } from "@/lib/instrument-display";
import type { AnalysisRead } from "@/lib/cairn-v2/analysis-contract";
import type { PortfolioRiskInputExclusion } from "@/lib/portfolio-risk-input-types";
import styles from "./analysis.module.css";

type Exclusion = AnalysisRead["exclusions"][number] | PortfolioRiskInputExclusion;

const reasons: Record<Exclusion["reason"], string> = {
  missing_ticker: "종목 코드 없음",
  non_positive_holding: "보유 수량이 0 이하",
  unsupported_currency: "지원하지 않는 통화",
  missing_price: "가격 없음",
  missing_fx: "환율 없음",
};

export function AnalysisExclusions({ rows }: { rows: readonly Exclusion[] }) {
  if (!rows.length) return null;
  return <ul className={styles.exclusions} aria-label="제외된 종목과 이유">
    {rows.map((row, index) => <li key={`${row.account}-${row.ticker ?? row.name}-${index}`}>
      <span>{instrumentLabel(row)} <small>{row.account}</small></span>
      <span>{reasons[row.reason]}</span>
    </li>)}
  </ul>;
}
