"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  Database,
  ScanLine,
  SlidersHorizontal,
  X,
} from "lucide-react";
import styles from "./simulation-workspace.module.css";

type SimulationOverlay = "weights" | "validation" | "evidence";

const OVERLAYS = {
  weights: { label: "비중 실험", icon: SlidersHorizontal, description: "구성을 조정했을 때 분포와 위험의 차이를 비교합니다." },
  validation: { label: "과거 검증", icon: ScanLine, description: "과거 구간 밖에서 실제 결과와 모형의 예측을 대조합니다." },
  evidence: { label: "모형·데이터", icon: Database, description: "포함 종목과 데이터 누락, 모형의 가정을 확인합니다." },
} as const;

export function SimulationWorkspace({
  paths,
  weights,
  validation,
  evidence,
  tools,
}: {
  paths: ReactNode;
  weights: ReactNode;
  validation: ReactNode;
  evidence: ReactNode;
  tools?: ReactNode;
}) {
  const params = useSearchParams();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeOverlay, setActiveOverlay] = useState<SimulationOverlay | null>(
    () => {
      const requested = params.get("view");
      return isSimulationOverlay(requested) ? requested : null;
    },
  );
  const panels = { weights, validation, evidence };

  useEffect(() => {
    if (!activeOverlay || dialogRef.current?.open) return;
    dialogRef.current?.showModal();
  }, [activeOverlay]);

  useEffect(() => {
    if (!activeOverlay) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [activeOverlay]);

  useEffect(() => {
    function syncOverlayFromHistory() {
      const requested = new URLSearchParams(window.location.search).get("view");
      const nextOverlay = isSimulationOverlay(requested) ? requested : null;
      setActiveOverlay(nextOverlay);
      if (!nextOverlay && dialogRef.current?.open) dialogRef.current.close();
    }

    window.addEventListener("popstate", syncOverlayFromHistory);
    return () => window.removeEventListener("popstate", syncOverlayFromHistory);
  }, []);

  function openOverlay(view: SimulationOverlay) {
    setActiveOverlay(view);
    const next = new URLSearchParams(window.location.search);
    next.set("view", view);
    window.history.pushState(null, "", `${window.location.pathname}?${next}`);
  }

  function closeOverlay() {
    dialogRef.current?.close();
  }

  function finishClose() {
    setActiveOverlay(null);
    const next = new URLSearchParams(window.location.search);
    next.delete("view");
    const query = next.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }

  const activeDefinition = activeOverlay ? OVERLAYS[activeOverlay] : null;

  return (
    <div className={styles.workspace} data-simulation-workspace="integrated">
      <div className={styles.toolbar}><span>현재 보유 구성 · 연구 분포</span><div>{tools}</div></div>

      <div className={styles.canvas}>{paths}</div>

      <div className={styles.launchers}>
        {(Object.keys(OVERLAYS) as SimulationOverlay[]).map((view) => {
          const { icon: Icon, label, description } = OVERLAYS[view];
          return (
            <button className={styles.launcher} key={view} onClick={() => openOverlay(view)} type="button">
              <Icon aria-hidden="true" size={21} strokeWidth={1.6} />
              <span><strong>{label}</strong><span className="sr-only">{description}</span></span>
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
        onClose={finishClose}
        ref={dialogRef}
      >
        <div className="varda-presentation-dialog-shell">
          <header className="varda-dialog-header flex shrink-0 items-center justify-between gap-4">
            <div>
              <p className="varda-kicker">SIMULATION WORKSPACE</p>
              <h2 className="mt-1 text-xl font-medium" id={titleId}>
                {activeDefinition?.label ?? "시뮬레이션 상세"}
              </h2>
            </div>
            <button
              aria-label="닫기"
              className="varda-icon-button"
              onClick={closeOverlay}
              title="닫기"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="varda-dialog-content varda-presentation-dialog-content varda-overlay-surface">
            {activeOverlay ? panels[activeOverlay] : null}
          </div>
        </div>
      </dialog>
    </div>
  );
}

function isSimulationOverlay(value: string | null): value is SimulationOverlay {
  return value === "weights" || value === "validation" || value === "evidence";
}
