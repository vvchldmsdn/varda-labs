"use client";

import { SimulationText, useSimulationText } from "@/components/simulation/simulation-text";


import { useEffect, useId, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useResearchPanelNavigation } from "@/components/investment-lab/research-detail-resource";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import { resolveSimulationPanel } from "@/lib/simulation-panel";
import {
  Database,
  ScanLine,
  SlidersHorizontal,
  X,
} from "lucide-react";
import styles from "./simulation-workspace.module.css";
import { SimulationLoading } from "./simulation-loading";
import loadingStyles from "./simulation-loading.module.css";
import { ActionGroup, ActionContent, Button as CairnButton, IconButton, SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";


const RemotePanel = dynamic(() => import("./simulation-remote-panel"), { loading: () => <SimulationLoading phase="evidence" compact /> });

type SimulationOverlay = "weights" | "validation" | "evidence";

const OVERLAYS = {
  weights: { label: "비중 실험", title: "비중을 바꿔 비교하기", titleEn: "Compare different weights", icon: SlidersHorizontal, description: "같은 조건에서 구성별 차이", descriptionEn: "Different allocations, same conditions" },
  validation: { label: "과거 검증", title: "과거 결과와 비교하기", titleEn: "Compare with past outcomes", icon: ScanLine, description: "학습에 쓰지 않은 구간의 결과", descriptionEn: "Outcomes outside the fitting period" },
  evidence: { label: "모형·데이터", title: "사용한 자료 확인하기", titleEn: "Review the inputs", icon: Database, description: "포함 종목과 계산 가정", descriptionEn: "Included holdings and assumptions" },
} as const;

export function SimulationWorkspace({
  paths,
  tools,
}: {
  paths: ReactNode;
  tools?: ReactNode;
}) {
  const pt = useSimulationText();
  const { panel: activeOverlay, select, query } = useResearchPanelNavigation(resolveSimulationPanel);
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

  function openOverlay(view: SimulationOverlay) { select(view); }
  function closeOverlay() {
    dialogRef.current?.close();
  }

  function finishClose() { select(null); }
  useEffect(() => { if (!activeOverlay && dialogRef.current?.open) dialogRef.current.close(); }, [activeOverlay]);

  const activeDefinition = activeOverlay ? OVERLAYS[activeOverlay] : null;

  return (
    <div className={styles.workspace} data-simulation-workspace="integrated">
      <div className={styles.toolbar}><div>{tools}</div></div>

      <div className={`${styles.canvas} ${loadingStyles.resultFrame}`}>
        <div className={loadingStyles.pendingResult}><SimulationLoading /></div>
        <div className={loadingStyles.settledResult}>{paths}</div>
      </div>

      <ActionGroup label={pt("시뮬레이션 이어서 살펴보기", "Explore the simulation")}>
        {(Object.keys(OVERLAYS) as SimulationOverlay[]).map((view) => {
          const { icon: Icon, title, titleEn, description, descriptionEn } = OVERLAYS[view];
          return (
            <CairnButton variant="bare" key={view} onClick={() => openOverlay(view)} type="button">
              <ActionContent icon={<Icon size={22} strokeWidth={1.6} />} title={<SimulationText ko={title} en={titleEn} />} description={<SimulationText ko={description} en={descriptionEn} />} />
            </CairnButton>
          );
        })}
      </ActionGroup>

      <dialog
        aria-labelledby={titleId}
        className="varda-dialog varda-presentation-dialog varda-presentation-dialog-wide"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeOverlay();
        }}
        onClose={(event) => {
          if (event.target !== event.currentTarget) return;
          event.stopPropagation();
          if (!dialogRef.current?.open) finishClose();
        }}
        ref={dialogRef}
      >
        <div className="varda-presentation-dialog-shell">
          <header className="varda-dialog-header flex shrink-0 items-center justify-between gap-4">
            <div>
              <CairnSectionTitle className="text-xl font-medium" id={titleId}>
                <SimulationText ko={activeDefinition?.label ?? "시뮬레이션 상세"} />
              </CairnSectionTitle>
            </div>
            <IconButton
              label={pt("닫기")}
              onClick={closeOverlay}
              title={pt("닫기")}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </IconButton>
          </header>
          <div className="varda-dialog-content varda-presentation-dialog-content varda-overlay-surface">
            {activeOverlay ? <RemotePanel query={query} /> : null}
          </div>
        </div>
      </dialog>
    </div>
  );
}
