"use client";

import { useId, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ChartNoAxesCombined, Layers3, SlidersHorizontal } from "lucide-react";

const VIEWS = [
  { id: "compare", label: "과거 비교", icon: ChartNoAxesCombined },
  { id: "weights", label: "비중 실험", icon: SlidersHorizontal },
  { id: "composition", label: "구성 분석", icon: Layers3 },
] as const;

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
  const id = useId();
  const selected =
    VIEWS.find((view) => view.id === params.get("view"))?.id ?? "compare";
  const panels = { compare: comparison, weights: experiments, composition };

  function select(view: string) {
    const next = new URLSearchParams(window.location.search);
    if (view === "compare") next.delete("view");
    else next.set("view", view);
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}?${next.toString()}`,
    );
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % VIEWS.length
        : event.key === "ArrowLeft"
          ? (index + VIEWS.length - 1) % VIEWS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? VIEWS.length - 1
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = VIEWS[nextIndex]!;
    select(next.id);
    document.getElementById(`${id}-${next.id}-tab`)?.focus();
  }

  return (
    <div data-lab-workspace={selected}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 border-b border-[#dde1db]">
        <div
          aria-label="투자랩 분석"
          className="flex min-w-0 gap-5 sm:gap-8"
          role="tablist"
        >
          {VIEWS.map(({ id: view, label, icon: Icon }, index) => (
            <button
              key={view}
              aria-controls={`${id}-${view}-panel`}
              aria-selected={selected === view}
              className={`flex min-h-12 items-center gap-2 border-b-2 px-0.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#438574] sm:text-sm ${selected === view ? "border-[#253e35] text-[#203a31]" : "border-transparent text-[#777e77] hover:text-[#202a24]"}`}
              id={`${id}-${view}-tab`}
              onClick={() => select(view)}
              onKeyDown={(event) => navigate(event, index)}
              role="tab"
              tabIndex={selected === view ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" size={15} strokeWidth={1.6} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex min-h-12 items-center gap-4">{tools}</div>
      </div>
      {VIEWS.map((view) => (
        <div
          key={view.id}
          aria-labelledby={`${id}-${view.id}-tab`}
          hidden={selected !== view.id}
          id={`${id}-${view.id}-panel`}
          role="tabpanel"
          tabIndex={0}
          className="min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#438574]"
        >
          {panels[view.id]}
        </div>
      ))}
    </div>
  );
}
