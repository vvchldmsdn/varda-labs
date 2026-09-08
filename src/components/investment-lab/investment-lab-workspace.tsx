"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";
import { resolveInvestmentLabPanel, type InvestmentLabPanel } from "@/lib/investment-lab-panel";
import {
  ArrowUpRight,
  Layers3,
  SlidersHorizontal,
  X,
} from "lucide-react";
import styles from "./investment-lab-modern.module.css";

type LabOverlay = InvestmentLabPanel;

export function InvestmentLabWorkspace({
  comparison,
  experiments,
  composition,
  tools,
  loadedPanel,
}: {
  comparison: ReactNode;
  experiments: ReactNode;
  composition: ReactNode;
  tools?: ReactNode;
  loadedPanel: InvestmentLabPanel | null;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeOverlay, setActiveOverlay] = useState<LabOverlay | null>(() => {
    const requested = params.getAll("view");
    return resolveInvestmentLabPanel(requested.length === 1 ? requested[0] : null);
  });

  useEffect(() => {
    if (!activeOverlay || dialogRef.current?.open) return;
    dialogRef.current?.showModal();
  }, [activeOverlay]);

  useEffect(() => {
    if (!activeOverlay) return;
    return acquireBodyScrollLock(document.body);
  }, [activeOverlay]);

  useEffect(() => {
    function syncOverlayFromHistory() {
      const requested = new URLSearchParams(window.location.search).getAll("view");
      const nextOverlay = resolveInvestmentLabPanel(requested.length === 1 ? requested[0] : null);
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
    startTransition(() => {
      router.push(`${window.location.pathname}?${next}`, { scroll: false });
    });
  }

  function closeOverlay() {
    dialogRef.current?.close();
  }

  function finishClose() {
    setActiveOverlay(null);
    const next = new URLSearchParams(window.location.search);
    next.delete("view");
    const query = next.toString();
    const href = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    if (isPending) startTransition(() => router.replace(href, { scroll: false }));
    else window.history.replaceState(null, "", href);
  }

  const activeContent =
    activeOverlay === "weights" ? experiments : composition;
  const activeTitle =
    activeOverlay === "weights" ? "비중 실험" : "포트폴리오 구성 분석";

  return (
    <div className={styles.workspace} data-lab-workspace="integrated">
      <div className={styles.toolbar}><span>같은 기간 · 같은 입출금</span><div>{tools}</div></div>

      <div className={styles.canvas}>{comparison}</div>

      <div className={styles.launchers}>
        <button className={styles.launcher} onClick={() => openOverlay("weights")} type="button">
          <SlidersHorizontal aria-hidden="true" size={22} strokeWidth={1.6} />
          <span><strong>비중 실험</strong><span className="sr-only">자산 비중을 바꾸고 실제 경로와 비교해 보세요.</span></span>
          <ArrowUpRight aria-hidden="true" size={18} />
        </button>
        <button className={styles.launcher} onClick={() => openOverlay("composition")} type="button">
          <Layers3 aria-hidden="true" size={22} strokeWidth={1.6} />
          <span><strong>구성 분석</strong><span className="sr-only">포트폴리오 구성과 종목 간 노출을 살펴보세요.</span></span>
          <ArrowUpRight aria-hidden="true" size={18} />
        </button>
      </div>
      <p className={styles.stageFootnote}>과거 기록과 가정의 비교입니다. 투자 추천이나 실제 주문으로 이어지지 않습니다.</p>

      <dialog
        aria-labelledby={titleId}
        className="varda-dialog varda-presentation-dialog varda-presentation-dialog-wide"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeOverlay();
        }}
        onClose={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) finishClose();
        }}
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
            {activeOverlay && loadedPanel !== activeOverlay
              ? <p role="status" className="motion-safe:animate-pulse py-10 text-sm text-[var(--muted)]">선택한 분석을 계산하고 있습니다.</p>
              : activeOverlay ? activeContent : null}
          </div>
        </div>
      </dialog>
    </div>
  );
}
