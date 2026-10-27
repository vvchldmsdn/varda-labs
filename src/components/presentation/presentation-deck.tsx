"use client";

import {
  Children,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type PresentationSceneDefinition = Readonly<{
  id: string;
  label: string;
}>;

export function PresentationDeck({
  ariaLabel,
  children,
  scenes,
}: {
  ariaLabel: string;
  children: ReactNode;
  scenes: readonly PresentationSceneDefinition[];
}) {
  const panels = Children.toArray(children);
  const instanceId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const activeScene = scenes[activeIndex] ?? scenes[0];

  useEffect(() => {
    const syncFromLocation = () => {
      const sceneId = readSceneId(window.location.hash);
      const nextIndex = scenes.findIndex((scene) => scene.id === sceneId);
      setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
    };

    syncFromLocation();
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [scenes]);

  if (scenes.length === 0 || panels.length === 0) return null;

  function selectScene(nextIndex: number, mode: "push" | "replace" = "push") {
    const boundedIndex = Math.max(0, Math.min(scenes.length - 1, nextIndex));
    const nextScene = scenes[boundedIndex];
    if (!nextScene || boundedIndex === activeIndex) return;

    setActiveIndex(boundedIndex);
    const url = new URL(window.location.href);
    url.hash = `scene=${encodeURIComponent(nextScene.id)}`;
    window.history[mode === "replace" ? "replaceState" : "pushState"](
      { ...window.history.state, vardaScene: nextScene.id },
      "",
      url,
    );
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % scenes.length
        : event.key === "ArrowLeft"
          ? (index + scenes.length - 1) % scenes.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? scenes.length - 1
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    selectScene(nextIndex);
    document
      .getElementById(`${instanceId}-${scenes[nextIndex]?.id}-tab`)
      ?.focus();
  }

  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (!isSwipeSurface(event.target)) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
  }

  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return;
    }
    selectScene(activeIndex + (deltaX < 0 ? 1 : -1));
  }

  return (
    <section
      aria-label={ariaLabel}
      className="varda-presentation-deck"
      data-active-scene={activeScene?.id}
    >
      <div
        className="varda-presentation-stage"
        onPointerDown={startSwipe}
        onPointerUp={finishSwipe}
      >
        <div
          className="varda-presentation-track"
          style={{ "--varda-scene-offset": `${activeIndex * -100}%` } as CSSProperties}
        >
          {panels.slice(0, scenes.length).map((panel, index) => {
            const scene = scenes[index]!;
            const active = index === activeIndex;
            return (
              <div
                aria-hidden={!active}
                aria-labelledby={`${instanceId}-${scene.id}-tab`}
                className="varda-presentation-scene"
                data-scene={scene.id}
                data-state={active ? "active" : "inactive"}
                id={`${instanceId}-${scene.id}-panel`}
                inert={!active}
                key={scene.id}
                role="tabpanel"
              >
                <div className="varda-presentation-scene-inner">{panel}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="varda-presentation-controls">
        <button
          aria-label="이전 장면"
          className="varda-presentation-arrow"
          disabled={activeIndex === 0}
          onClick={() => selectScene(activeIndex - 1)}
          title="이전 장면"
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.6} />
        </button>
        <div aria-label={`${ariaLabel} 장면`} className="varda-presentation-tabs" role="tablist">
          {scenes.map((scene, index) => {
            const active = index === activeIndex;
            return (
              <button
                aria-controls={`${instanceId}-${scene.id}-panel`}
                aria-selected={active}
                className="varda-presentation-tab"
                id={`${instanceId}-${scene.id}-tab`}
                key={scene.id}
                onClick={() => selectScene(index)}
                onKeyDown={(event) => navigateTabs(event, index)}
                role="tab"
                tabIndex={active ? 0 : -1}
                type="button"
              >
                <span aria-hidden="true" className="varda-presentation-tab-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="varda-presentation-tab-label">{scene.label}</span>
              </button>
            );
          })}
        </div>
        <button
          aria-label="다음 장면"
          className="varda-presentation-arrow"
          disabled={activeIndex === scenes.length - 1}
          onClick={() => selectScene(activeIndex + 1)}
          title="다음 장면"
          type="button"
        >
          <ChevronRight aria-hidden="true" size={18} strokeWidth={1.6} />
        </button>
        <p aria-live="polite" className="sr-only">
          {activeScene?.label}, {activeIndex + 1}/{scenes.length}
        </p>
      </div>
    </section>
  );
}

function readSceneId(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get("scene");
}

function isSwipeSurface(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  return !target.closest(
    "a, button, input, select, textarea, summary, [role='button'], [role='slider'], [data-no-swipe]",
  );
}
