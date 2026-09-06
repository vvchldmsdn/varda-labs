"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChartNoAxesCombined,
  Database,
  ScanLine,
  SlidersHorizontal,
  X,
} from "lucide-react";

type SimulationOverlay = "weights" | "validation" | "evidence";

const OVERLAYS = {
  weights: { label: "비중 실험", icon: SlidersHorizontal },
  validation: { label: "과거 검증", icon: ScanLine },
  evidence: { label: "모형·데이터", icon: Database },
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
    <div className="varda-workspace-main" data-simulation-workspace="integrated">
      <div className="varda-workspace-commandbar">
        <div>
          <ChartNoAxesCombined aria-hidden="true" size={16} strokeWidth={1.6} />
          <span className="text-xs font-medium text-[var(--muted)]">
            확률 경로와 하방 범위
          </span>
        </div>
        <div>
          {tools}
          {(Object.keys(OVERLAYS) as SimulationOverlay[]).map((view) => {
            const { icon: Icon, label } = OVERLAYS[view];
            return (
              <button
                className="varda-inline-action"
                key={view}
                onClick={() => openOverlay(view)}
                type="button"
              >
                <Icon aria-hidden="true" size={15} strokeWidth={1.6} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="varda-workspace-canvas">{paths}</div>

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
