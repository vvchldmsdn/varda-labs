"use client";

import { Fragment, useId, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import type { CalculationGuideDefinition, GuideCopy } from "./calculation-guide-types";
import styles from "./calculation-guide.module.css";

export default function CalculationGuide({ guide }: { guide: CalculationGuideDefinition }) {
  const { locale, t } = useI18n();
  const [activeIndex, setActiveIndex] = useState(0);
  const guideRef = useRef<HTMLElement>(null);
  const stepsRef = useRef<HTMLOListElement>(null);
  const panelId = useId();
  const stepIndex = Math.min(activeIndex, guide.steps.length - 1);
  const step = guide.steps[stepIndex];
  const copy = (value: GuideCopy) => value[locale];
  if (!step) return null;

  function showStep(index: number) {
    setActiveIndex(index);
    stepsRef.current?.querySelectorAll("button")[index]?.focus({ preventScroll: true });
    guideRef.current?.closest<HTMLElement>(".varda-presentation-dialog-content")?.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  return <section ref={guideRef} className={styles.guide} data-calculation-guide={guide.id}>
    <p className={styles.intro}>{copy(guide.intro)}</p>
    <ol ref={stepsRef} className={styles.steps} aria-label={t("계산 순서", "Calculation steps")}>
      {guide.steps.map((item, index) => <li key={item.id}>
        <button type="button" aria-current={index === stepIndex ? "step" : undefined} aria-controls={panelId} onClick={() => showStep(index)}>
          <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
          <span>{copy(item.label)}</span>
        </button>
      </li>)}
    </ol>

    <div id={panelId} className={styles.panel} aria-live="polite" aria-atomic="true">
      <article key={step.id} className={styles.stage}>
        <div className={styles.explanation}>
          <p className={styles.kicker}>{t("계산 과정", "HOW IT WORKS")} · {stepIndex + 1} / {guide.steps.length}</p>
          <h3>{copy(step.title)}</h3>
          <p>{copy(step.body)}</p>
          {step.example ? <div className={styles.example}><strong>{copy(step.example.label)}</strong><p>{copy(step.example.body)}</p></div> : null}
        </div>
        <ol className={styles.flow} aria-label={t("이 단계의 흐름", "Flow in this step")}>
          {step.nodes.map((node, index) => <Fragment key={index}>
            {index > 0 ? <li className={styles.arrow} aria-hidden="true"><ArrowRight size={20} /><ArrowDown size={20} /></li> : null}
            <li className={styles.node} style={{animationDelay: `${index * 65}ms`}}>
              <span className={styles.nodeDot} aria-hidden="true" />
              <strong>{copy(node.label)}</strong>
              {node.detail ? <span>{copy(node.detail)}</span> : null}
            </li>
          </Fragment>)}
        </ol>
        <p className={styles.takeAway}><Check size={17} aria-hidden="true" /><span>{copy(step.takeAway)}</span></p>
      </article>
    </div>
    {step.detail ? <details className={styles.detail} key={step.id}><summary>{t("정확한 계산 방식 보기", "See the exact method")}</summary><p>{copy(step.detail)}</p></details> : null}
    <nav className={styles.pager} aria-label={t("설명 단계 이동", "Guide navigation")}>
      <button type="button" disabled={stepIndex === 0} onClick={() => showStep(Math.max(0, stepIndex - 1))}><ArrowLeft size={16} aria-hidden="true" />{t("이전", "Previous")}</button>
      <span>{stepIndex + 1} / {guide.steps.length}</span>
      <button type="button" disabled={stepIndex === guide.steps.length - 1} onClick={() => showStep(Math.min(guide.steps.length - 1, stepIndex + 1))}>{t("다음", "Next")}<ArrowRight size={16} aria-hidden="true" /></button>
    </nav>
    {guide.notes?.length ? <details className={styles.detail}>
      <summary>{t("용어와 해석할 때 주의할 점", "Terms and interpretation")}</summary>
      <dl className={styles.notes}>{guide.notes.map((note, index) => <div key={index}><dt>{copy(note.title)}</dt><dd>{copy(note.body)}</dd></div>)}</dl>
    </details> : null}
    {guide.footnote ? <p className={styles.footnote}>{copy(guide.footnote)}</p> : null}
  </section>;
}
