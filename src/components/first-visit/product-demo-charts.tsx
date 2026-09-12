"use client";
import { useState } from "react";
import { InvestmentLabChartCanvas } from "@/components/investment-lab/investment-lab-chart-canvas";
import { ResearchFanChart } from "@/components/simulation/research-fan-chart";
import type { PublicProductDemo } from "@/lib/public-product-demo";
import styles from "./product-tour.module.css";

export default function ProductDemoCharts({ data }: { data: PublicProductDemo }) {
  const [selectedId, setSelectedId] = useState("fixed_mix");
  if (data.kind === "simulation") return <div className={styles.simulation} data-public-simulation><ResearchFanChart execution={data.execution} /></div>;
  const actual = data.chart.lines.find(line => line.id === "actual")!;
  const selected = data.chart.lines.find(line => line.id === selectedId) ?? data.chart.lines[1];
  return <div className={styles.lab}>
    <label className={styles.scenario}>비교할 예시 전략
      <select value={selected.id} onChange={event => setSelectedId(event.target.value)}>
        <option value="fixed_mix">국내·미국 지수 혼합</option><option value="kodex200">국내 지수 보유</option><option value="voo">미국 지수 보유</option>
      </select>
    </label>
    <InvestmentLabChartCanvas key={selected.id} chart={data.chart} actual={actual} selected={selected} sample />
    <p className={styles.legend}><span>━ 샘플 포트폴리오</span><span>━ 비교 전략</span></p>
  </div>;
}
