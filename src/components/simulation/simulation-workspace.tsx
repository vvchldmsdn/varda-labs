"use client";

import { useId, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChartNoAxesCombined,
  SlidersHorizontal,
  ScanLine,
  Database,
} from "lucide-react";

const VIEWS = [
  { id: "paths", label: "확률 경로", icon: ChartNoAxesCombined },
  { id: "weights", label: "비중 실험", icon: SlidersHorizontal },
  { id: "validation", label: "과거 검증", icon: ScanLine },
  { id: "evidence", label: "모형·데이터", icon: Database },
] as const;

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
  const id = useId();
  const selected =
    VIEWS.find((view) => view.id === params.get("view"))?.id ?? "paths";
  const panels = { paths, weights, validation, evidence };

  function select(view: string) {
    const next = new URLSearchParams(window.location.search);
    if (view === "paths") next.delete("view");
    else next.set("view", view);
    window.history.pushState(null, "", `${window.location.pathname}?${next}`);
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % VIEWS.length
        : event.key === "ArrowLeft"
          ? (index + VIEWS.length - 1) % VIEWS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? VIEWS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    select(VIEWS[next].id);
    document.getElementById(`${id}-${VIEWS[next].id}-tab`)?.focus();
  }

  return (
    <div data-simulation-workspace={selected}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 border-b border-[#dde1db]">
        <div
          className="flex max-w-full gap-4 overflow-x-auto sm:gap-8"
          role="tablist"
          aria-label="시뮬레이션 분석"
        >
          {VIEWS.map(({ id: view, label, icon: Icon }, index) => (
            <button
              key={view}
              type="button"
              role="tab"
              id={`${id}-${view}-tab`}
              aria-controls={`${id}-${view}-panel`}
              aria-selected={selected === view}
              tabIndex={selected === view ? 0 : -1}
              onClick={() => select(view)}
              onKeyDown={(event) => navigate(event, index)}
              className={`flex min-h-12 shrink-0 items-center gap-2 border-b-2 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-[#438574] sm:text-sm ${selected === view ? "border-[#253e35] text-[#203a31]" : "border-transparent text-[#737b73] hover:text-[#202a24]"}`}
            >
              <Icon
                aria-hidden="true"
                size={15}
                strokeWidth={1.6}
                className="hidden sm:block"
              />
              {label}
            </button>
          ))}
        </div>
        {tools ? (
          <div className="flex min-h-11 items-center gap-3">{tools}</div>
        ) : null}
      </div>
      {VIEWS.map((view) => (
        <div
          key={view.id}
          role="tabpanel"
          id={`${id}-${view.id}-panel`}
          aria-labelledby={`${id}-${view.id}-tab`}
          hidden={selected !== view.id}
          className="min-w-0 focus-visible:outline-2 focus-visible:outline-[#438574]"
          tabIndex={0}
        >
          {panels[view.id]}
        </div>
      ))}
    </div>
  );
}
