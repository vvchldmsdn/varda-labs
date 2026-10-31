"use client";

import { LabText } from "./lab-text";
import { T } from "@/components/i18n/localized-text";
import { InvestmentLabFirstSteps } from "./investment-lab-first-steps";
import { CalculationGuideDialog } from "@/components/explanations/calculation-guide-dialog";
import { investmentLabCalculationGuide } from "./investment-lab-calculation-guide";
import { useI18n } from "@/components/i18n/locale-provider";

import { useEffect, useId, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useResearchPanelNavigation } from "./research-detail-resource";
import type { InvestmentLabWeightEvidence } from "@/lib/investment-lab-weight-evidence";
import type { PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import { resolveInvestmentLabPanel, type InvestmentLabPanel } from "@/lib/investment-lab-panel";
import {
  Layers3,
  SlidersHorizontal,
  X,
} from "lucide-react";
import styles from "./investment-lab-modern.module.css";
import { ActionGroup, ActionContent, Button as CairnButton, IconButton, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";


const RemotePanel = dynamic(() => import("./investment-lab-remote-panel"), { loading: () => <CairnStatus as="p" tone="neutral" role="status" className="py-10 text-sm"><LabText value="상세 분석을 불러오고 있습니다." /></CairnStatus> });

type LabOverlay = InvestmentLabPanel;

export function InvestmentLabWorkspace({
  comparison,
  weights,
  scopeKey,
  tools,
  showFirstSteps = false,
}: {
  comparison: ReactNode;
  weights: InvestmentLabWeightEvidence;
  scopeKey: PortfolioAnalysisScopeKey;
  tools?: ReactNode;
  showFirstSteps?: boolean;
}) {
  const { t } = useI18n();
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
      <div className={styles.toolbar}><span>{showFirstSteps ? <T ko="현재 구성으로 하는 가상 실험" en="Hypothetical experiments with today's holdings" /> : <LabText value="같은 기간 · 같은 투자금 흐름" />}</span><div>{tools}<CalculationGuideDialog guide={investmentLabCalculationGuide} label={{ ko: "계산 원리", en: "How it works" }} title={{ ko: "투자 방법만 바꿔 보면", en: "What if you changed the investment method?" }} /></div></div>

      <div className={styles.canvas}>{showFirstSteps ? <InvestmentLabFirstSteps preview={new URLSearchParams(query).get("preview") === "design"} scopeKey={scopeKey} onOpenPanel={openOverlay} /> : comparison}</div>

      {!showFirstSteps ? <ActionGroup label={t("다른 관점으로 살펴보기", "Explore another perspective")}>
        <CairnButton variant="bare" onClick={() => openOverlay("weights")} type="button"><ActionContent icon={<SlidersHorizontal />} title={<T ko="비중을 바꾸면 어떨까요?" en="What if the weights changed?" />} description={<T ko="다른 구성과 비교" en="Compare another allocation" />} /></CairnButton>
        <CairnButton variant="bare" onClick={() => openOverlay("composition")} type="button"><ActionContent icon={<Layers3 />} title={<T ko="내 종목은 얼마나 겹칠까요?" en="Where do my holdings overlap?" />} description={<T ko="ETF 구성과 과거 구간 살펴보기" en="Explore ETF holdings and past periods" />} /></CairnButton>
      </ActionGroup> : null}
      <p className={styles.stageFootnote}><T ko="과거 기록과 가상의 비교 · 실제 거래 아님" en="Historical and hypothetical comparison · No actual trades" /></p>

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
              <CairnSectionTitle className="mt-1 text-xl font-medium" id={titleId}>
                <LabText value={activeTitle} />
              </CairnSectionTitle>
            </div>
            <IconButton
              label={t("닫기", "Close")}
              onClick={closeOverlay}
              title={t("닫기", "Close")}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </IconButton>
          </header>
          <div className="varda-dialog-content varda-presentation-dialog-content varda-overlay-surface">
            {activeOverlay ? <RemotePanel query={query} weights={weights} scopeKey={scopeKey} /> : null}
          </div>
        </div>
      </dialog>
    </div>
  );
}
