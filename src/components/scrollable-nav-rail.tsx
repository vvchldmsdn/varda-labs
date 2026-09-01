"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ScrollableNavRail({
  ariaLabel,
  children,
  contentClassName = "",
  viewportClassName = "",
}: {
  ariaLabel: string;
  children: ReactNode;
  contentClassName?: string;
  viewportClassName?: string;
}) {
  const viewportRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateEdges = () => {
      const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      setEdges({
        atStart: viewport.scrollLeft <= 1,
        atEnd: viewport.scrollLeft >= maximum - 1,
      });
    };
    const frame = window.requestAnimationFrame(() => {
      viewport
        .querySelector<HTMLElement>('[aria-current="page"]')
        ?.scrollIntoView({ block: "nearest", inline: "center" });
      updateEdges();
    });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(viewport);
    viewport.addEventListener("scroll", updateEdges, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener("scroll", updateEdges);
    };
  }, [children]);

  return (
    <nav
      ref={viewportRef}
      aria-label={ariaLabel}
      className={`varda-scroll-rail ${viewportClassName}`}
      data-at-end={edges.atEnd}
      data-at-start={edges.atStart}
    >
      <div className={contentClassName}>{children}</div>
    </nav>
  );
}
