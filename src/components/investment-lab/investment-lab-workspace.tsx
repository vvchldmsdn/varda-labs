"use client";

import { LabText } from "./lab-text";
import { labEnglish } from "./lab-copy";
import { LocalizedElement } from "@/components/i18n/localized-element";

import { useEffect, useId, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useResearchPanelNavigation } from "./research-detail-resource";
import type { InvestmentLabWeightEvidence } from "@/lib/investment-lab-weight-evidence";
import type { PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import { resolveInvestmentLabPanel, type InvestmentLabPanel } from "@/lib/investment-lab-panel";
import {
  ArrowUpRight,
  Layers3,
  SlidersHorizontal,
  X,
} from "lucide-react";
import styles from "./investment-lab-modern.module.css";

const RemotePanel = dynamic(() => import("./investment-lab-remote-panel"), { loading: () => <p role="status" className="py-10 text-sm"><LabText value="상세 분석을 불러오고 있습니다." /></p> });

type LabOverlay = InvestmentLabPanel;

export function InvestmentLabWorkspace({
  comparison,
  weights,
  scopeKey,
  tools,
}: {
  comparison: ReactNode;
  weights: InvestmentLabWeightEvidence;
  scopeKey: PortfolioAnalysisScopeKey;
  tools?: ReactNode;
}) {
  const { panel: activeOverlay, select, query } = useResearchPanelNavigation(resolveInvestmentLabPanel);
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!activeOverlay || dialogRef.current?.open) return;
    dialogRef.current?.showModal();
  }, [activeOverlay]);

  useEffect(() => {
    if (!activeOverlay) return;
    return acquireBodyScrollLock(document.body);
  }, [activeOverlay]);

  function openOverlay(view: LabOverlay) { select(view); }
  function closeOverlay() {
    dialogRef.current?.close();
  }

  function finishClose() { select(null); }
  useEffect(() => { if (!activeOverlay && dialogRef.current?.open) dialogRef.current.close(); }, [activeOverlay]);

  const activeTitle =
    activeOverlay === "weights" ? "비중 실험" : "포트폴리오 구성 분석";

  return (
    <div className={styles.workspace} data-lab-workspace="integrated">
      <div className={styles.toolbar}><span><LabText value="같은 기간 · 같은 입출금" /></span><div>{tools}</div></div>

      <div className={styles.canvas}>{comparison}</div>

      <div className={styles.launchers}>
        <button className={styles.launcher} onClick={() => openOverlay("weights")} type="button">
          <SlidersHorizontal aria-hidden="true" size={22} strokeWidth={1.6} />
          <span><strong><LabText value="비중 실험" /></strong><span className="sr-only"><LabText value="자산 비중을 바꾸고 실제 경로와 비교해 보세요." /></span></span>
          <ArrowUpRight aria-hidden="true" size={18} />
        </button>
        <button className={styles.launcher} onClick={() => openOverlay("composition")} type="button">
          <Layers3 aria-hidden="true" size={22} strokeWidth={1.6} />
          <span><strong><LabText value="구성 분석" /></strong><span className="sr-only"><LabText value="포트폴리오 구성과 종목 간 노출을 살펴보세요." /></span></span>
          <ArrowUpRight aria-hidden="true" size={18} />
        </button>
      </div>
      <p className={styles.stageFootnote}><LabText value="과거 기록과 가정의 비교입니다. 투자 추천이나 실제 주문으로 이어지지 않습니다." /></p>

      <dialog
        aria-labelledby={titleId}
        className="varda-dialog varda-presentation-dialog varda-presentation-dialog-wide"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeOverlay();
        }}
        onClose={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget && !dialogRef.current?.open) finishClose();
        }}
        ref={dialogRef}
      >
        <div className="varda-presentation-dialog-shell">
          <header className="varda-dialog-header flex shrink-0 items-center justify-between gap-4">
            <div>
              <p className="varda-kicker">LAB WORKSPACE</p>
              <h2 className="mt-1 text-xl font-medium" id={titleId}>
                <LabText value={activeTitle} />
              </h2>
            </div>
            <LocalizedElement as="button"
              aria-label="닫기"
              className="varda-icon-button"
              onClick={closeOverlay}
              title="닫기"
              type="button" en={{"aria-label": labEnglish("닫기"), "title": labEnglish("닫기")}}
            >
              <X aria-hidden="true" size={18} />
            </LocalizedElement>
          </header>
          <div className="varda-dialog-content varda-presentation-dialog-content varda-overlay-surface">
            {activeOverlay ? <RemotePanel query={query} weights={weights} scopeKey={scopeKey} /> : null}
          </div>
        </div>
      </dialog>
    </div>
  );
}
