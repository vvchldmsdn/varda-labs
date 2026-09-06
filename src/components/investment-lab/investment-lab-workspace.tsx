"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChartNoAxesCombined,
  Layers3,
  SlidersHorizontal,
  X,
} from "lucide-react";

type LabOverlay = "weights" | "composition";

export function InvestmentLabWorkspace({
  comparison,
  experiments,
  composition,
  tools,
}: {
  comparison: ReactNode;
  experiments: ReactNode;
  composition: ReactNode;
  tools?: ReactNode;
}) {
  const params = useSearchParams();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeOverlay, setActiveOverlay] = useState<LabOverlay | null>(() => {
    const requested = params.get("view");
    return isLabOverlay(requested) ? requested : null;
  });

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
      const nextOverlay = isLabOverlay(requested) ? requested : null;
      setActiveOverlay(nextOverlay);
      if (!nextOverlay && dialogRef.current?.open) dialogRef.current.close();
    }

    window.addEventListener("popstate", syncOverlayFromHistory);
    return () => window.removeEventListener("popstate", syncOverlayFromHistory);
  }, []);

  function openOverlay(view: LabOverlay) {
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

  const activeContent =
    activeOverlay === "weights" ? experiments : composition;
  const activeTitle =
    activeOverlay === "weights" ? "비중 실험" : "포트폴리오 구성 분석";

  return (
    <div className="varda-workspace-main" data-lab-workspace="integrated">
      <div className="varda-workspace-commandbar">
        <div>
          <ChartNoAxesCombined aria-hidden="true" size={16} strokeWidth={1.6} />
          <span className="text-xs font-medium text-[var(--muted)]">
            실제 경로와 대안 시나리오
          </span>
        </div>
        <div>
          {tools}
          <button
            className="varda-inline-action"
            onClick={() => openOverlay("weights")}
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" size={15} strokeWidth={1.6} />
            비중 실험
          </button>
          <button
            className="varda-inline-action"
            onClick={() => openOverlay("composition")}
            type="button"
          >
            <Layers3 aria-hidden="true" size={15} strokeWidth={1.6} />
            구성 분석
          </button>
        </div>
      </div>

      <div className="varda-workspace-canvas">{comparison}</div>

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
              <p className="varda-kicker">LAB WORKSPACE</p>
              <h2 className="mt-1 text-xl font-medium" id={titleId}>
                {activeTitle}
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
            {activeContent}
          </div>
        </div>
      </dialog>
    </div>
  );
}

function isLabOverlay(value: string | null): value is LabOverlay {
  return value === "weights" || value === "composition";
}
