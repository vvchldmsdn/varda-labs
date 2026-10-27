"use client";

import { useId } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import type { MethodFigure, MethodGuide } from "./method-types";
import styles from "./method.module.css";

export default function MethodExplorer({ guide }: { guide: MethodGuide }) {
  const { locale, t } = useI18n();
  return <section className={styles.explorer} aria-label={guide.title[locale]}>
    <header><p className={styles.eyebrow}>METHODOLOGY</p><h3>{guide.title[locale]}</h3><p>{guide.intro[locale]}</p></header>
    <p className={styles.exampleNotice}>{t("도식의 숫자는 원리를 보여주는 검산 예시이며 내 포트폴리오 결과가 아닙니다. 수익률은 별도 표시가 없으면 소수 단위입니다: 0.03 = 3%.", "Diagram numbers are worked examples, not your portfolio results. Returns are decimal fractions unless marked otherwise: 0.03 = 3%.")}</p>
    {guide.sections.map((section, index) => <details key={section.id} className={styles.section} open={index === 0}>
      <summary><span className={styles.index}>{String(index + 1).padStart(2, "0")}</span><h4>{section.title[locale].replace(/^\d{1,2}\s*[.·]\s*/, "")}</h4><span className={styles.expand} aria-hidden="true">＋</span></summary>
      <div className={styles.sectionBody}>
        <p className={styles.lead}>{section.lead[locale]}</p>
        <div className={styles.equations} aria-label={t("계산식과 해석", "Equations and interpretation")}>
          {section.equations.map((equation, equationIndex) => <div key={equationIndex}>
            <p className={styles.formula}>{equation.expression}</p><p>{equation.reading[locale]}</p>
          </div>)}
        </div>
        <details className={styles.notation}><summary>{t("기호와 단위", "Notation and units")}</summary>
          <dl>{section.symbols.map(symbol => <div key={symbol.symbol}><dt>{symbol.symbol}</dt><dd>{symbol.meaning[locale]}</dd></div>)}</dl>
        </details>
        <MethodDiagram figure={section.figure} />
        {section.example ? <p className={styles.example}><strong>{t("직접 검산하기", "Check the arithmetic")}</strong>{section.example[locale]}</p> : null}
        <p className={styles.caveat}><strong>{t("해석과 한계", "Interpretation and limits")}</strong>{section.caveat[locale]}</p>
      </div>
    </details>)}
  </section>;
}

function MethodDiagram({ figure }: { figure: MethodFigure }) {
  const { locale, t } = useI18n();
  const captionId = useId();
  const axisId = useId();
  const values = figure.kind === "lines" ? figure.series.flatMap(series => [...series.values]) : [];
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const y = (value: number) => 148 - (value - min) / span * 116;
  return <figure className={styles.figure} aria-labelledby={captionId}>
    <figcaption id={captionId}>{figure.caption[locale]}</figcaption>
    {figure.kind === "flow" ? <ol className={styles.flow}>{figure.nodes.map((node, index) => <li key={index}><span className={styles.index}>{String(index + 1).padStart(2, "0")}</span><strong>{node.label[locale]}</strong><p>{node.detail[locale]}</p>{index < figure.nodes.length - 1 ? <span className={styles.flowArrow} aria-hidden="true">→</span> : null}</li>)}</ol> : null}
    {figure.kind === "bars" ? <div className={styles.bars}>{figure.rows.map((row, index) => <div key={index}><span>{row.label[locale]}</span><div className={styles.barTrack}><span style={{ width: `${Math.abs(row.value) / Math.max(1, ...figure.rows.map(item => Math.abs(item.value))) * 100}%` }} data-negative={row.value < 0} /></div><strong>{row.value.toLocaleString(locale === "ko" ? "ko-KR" : "en-US")} {figure.unit[locale]}</strong></div>)}</div> : null}
    {figure.kind === "lines" ? <>
      <svg className={styles.lineChart} viewBox="0 0 480 190" role="img" aria-labelledby={`${captionId} ${axisId}`}>
        <title id={axisId}>{`${figure.yLabel[locale]} · ${figure.xLabel[locale]}`}</title>
        {[min, (min + max) / 2, max].map((value, index) => <g key={index}><line x1="50" x2="452" y1={y(value)} y2={y(value)} className={styles.gridLine} /><text x="42" y={y(value) + 4} textAnchor="end">{Number(value.toFixed(2))}</text></g>)}
        {figure.series.map((series, index) => <g key={index} className={[styles.primaryLine, styles.secondaryLine, styles.tertiaryLine][index % 3]}>
          <polyline points={series.values.map((value, point) => `${50 + point / Math.max(1, series.values.length - 1) * 402},${y(value)}`).join(" ")} fill="none" strokeWidth="2.5" strokeDasharray={[undefined, "7 4", "2 4"][index % 3]} />
          {series.values.map((value, point) => <circle key={point} cx={50 + point / Math.max(1, series.values.length - 1) * 402} cy={y(value)} r="3.5" />)}
        </g>)}
        <text x="50" y="177">{t("시작", "Start")}</text><text x="452" y="177" textAnchor="end">{t("마지막", "End")}</text>
      </svg>
      <div className={styles.legend}>{figure.series.map((series, index) => <span key={index}><i data-series={index % 3} />{series.label[locale]}</span>)}</div>
      <details className={styles.notation}><summary>{t("도식의 숫자 보기", "View diagram values")}</summary><dl>{figure.series.map((series, index) => <div key={index}><dt>{series.label[locale]}</dt><dd>{series.values.join(" → ")}</dd></div>)}</dl><p>{figure.xLabel[locale]} · {figure.yLabel[locale]}</p></details>
    </> : null}
  </figure>;
}
