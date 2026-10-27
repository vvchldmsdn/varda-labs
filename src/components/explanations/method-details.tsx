"use client";

import { lazy, Suspense, useState } from "react";
import { Sigma } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { T } from "@/components/i18n/localized-text";
import type { MethodTopic } from "./method-types";
import styles from "./method.module.css";

const MethodContent = lazy(() => import("./method-content"));

/** Explanatory content only; no portfolio data, engine imports, or provider requests. */
export function MethodDetails({ topic }: { topic: MethodTopic }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <details className={styles.disclosure} data-method-disclosure={topic} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Sigma size={19} aria-hidden="true" /><span><strong>{t("수식과 계산 과정", "Formulas and methodology")}</strong><small>{t("기호 정의 · 도식 · 검산 예시 · 가정과 한계", "Notation · diagrams · worked examples · assumptions")}</small></span></summary>
    {open ? <Suspense fallback={<p role="status"><T ko="수식과 도식을 불러오는 중입니다." en="Loading formulas and diagrams." /></p>}><MethodContent topic={topic} /></Suspense> : null}
  </details>;
}
