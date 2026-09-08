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

const RemotePanel = dynamic(() => import("./simulation-remote-panel"), { loading: () => <p role="status" className="py-10 text-sm"><SimulationText ko={"상세 분석을 불러오고 있습니다."} /></p> });

type SimulationOverlay = "weights" | "validation" | "evidence";

const OVERLAYS = {
  weights: { label: "비중 실험", icon: SlidersHorizontal, description: "구성을 조정했을 때 분포와 위험의 차이를 비교합니다." },
  validation: { label: "과거 검증", icon: ScanLine, description: "과거 구간 밖에서 실제 결과와 모형의 예측을 대조합니다." },
  evidence: { label: "모형·데이터", icon: Database, description: "포함 종목과 데이터 누락, 모형의 가정을 확인합니다." },
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
      <div className={styles.toolbar}><span><SimulationText ko={"현재 보유 구성 · 연구 분포"} /></span><div>{tools}</div></div>

      <div className={styles.canvas}>{paths}</div>

      <div className={styles.launchers}>
        {(Object.keys(OVERLAYS) as SimulationOverlay[]).map((view) => {
          const { icon: Icon, label, description } = OVERLAYS[view];
          return (
            <button className={styles.launcher} key={view} onClick={() => openOverlay(view)} type="button">
              <Icon aria-hidden="true" size={21} strokeWidth={1.6} />
              <span><strong><SimulationText ko={label} /></strong><span className="sr-only"><SimulationText ko={description} /></span></span>
            </button>
          );
        })}
      </div>

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
              <p className="varda-kicker">SIMULATION WORKSPACE</p>
              <h2 className="mt-1 text-xl font-medium" id={titleId}>
                <SimulationText ko={activeDefinition?.label ?? "시뮬레이션 상세"} />
              </h2>
            </div>
            <button
              aria-label={pt("닫기")}
              className="varda-icon-button"
              onClick={closeOverlay}
              title={pt("닫기")}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="varda-dialog-content varda-presentation-dialog-content varda-overlay-surface">
            {activeOverlay ? <RemotePanel query={query} /> : null}
          </div>
        </div>
      </dialog>
    </div>
  );
}
