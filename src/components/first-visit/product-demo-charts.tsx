"use client";
import { useI18n } from "@/components/i18n/locale-provider";
import { useState } from "react";
import { InvestmentLabChartCanvas } from "@/components/investment-lab/investment-lab-chart-canvas";
import { ResearchFanChart } from "@/components/simulation/research-fan-chart";
import type { PublicProductDemo } from "@/lib/public-product-demo";
import styles from "./product-tour.module.css";

export default function ProductDemoCharts({ data }: { data: PublicProductDemo }) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState("fixed_mix");
  if (data.kind === "simulation") return <div className={styles.simulation} data-public-simulation><ResearchFanChart execution={data.execution} /></div>;
  const actual = data.chart.lines.find(line => line.id === "actual")!;
  const selected = data.chart.lines.find(line => line.id === selectedId) ?? data.chart.lines[1];
  return <div className={styles.lab}>
    <label className={styles.scenario}>{t("비교할 예시 전략", "Example strategy")}
      <select className="cairn-form-select" value={selected.id} onChange={event => setSelectedId(event.target.value)}>
        <option value="fixed_mix">{t("국내·미국 지수 혼합", "Korean / US index mix")}</option><option value="kodex200">{t("국내 지수 보유", "Korean index")}</option><option value="voo">{t("미국 지수 보유", "US index")}</option>
      </select>
    </label>
    <InvestmentLabChartCanvas key={selected.id} chart={data.chart} actual={actual} selected={selected} sample />
    <p className={styles.legend}><span>{t("━ 샘플 포트폴리오", "━ Sample portfolio")}</span><span>{t("━ 비교 전략", "━ Comparison strategy")}</span></p>
  </div>;
}
