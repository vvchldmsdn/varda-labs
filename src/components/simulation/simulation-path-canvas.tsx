"use client";

import { memo, useEffect, useRef } from "react";
import {
  forEachSimulationFanPathPoint,
  nearestSimulationFanPathPoint,
  simulationFanPathCount,
  type SimulationFanPathSource,
} from "./simulation-presentation";
import styles from "./simulation-path-chart.module.css";

/** A single bitmap for the complete ensemble; pointer movement only changes the SVG overlay. */
export const SimulationPathCanvas = memo(function SimulationPathCanvas({
  source, width, height, x, y,
}: {
  source: SimulationFanPathSource;
  width: number;
  height: number;
  x: (step: number) => number;
  y: (value: number) => number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const tokens = getComputedStyle(canvas);
      const positive = tokens.getPropertyValue("--accent").trim() || "#de6946";
      const negative = tokens.getPropertyValue("--negative").trim() || "#648bb0";
      const neutral = tokens.getPropertyValue("--muted").trim() || "#777777";
      const count = simulationFanPathCount(source);
      context.globalAlpha = count > 100 ? 0.1 : 0.38;
      context.lineWidth = count > 100 ? 0.7 : 0.9;
      context.lineJoin = "round";
      for (let path = 0; path < count; path += 1) {
        const terminal = nearestSimulationFanPathPoint(source, path, Number.MAX_SAFE_INTEGER)?.indexValue ?? 100;
        context.strokeStyle = terminal > 102 ? positive : terminal < 98 ? negative : neutral;
        context.beginPath();
        let started = false;
        forEachSimulationFanPathPoint(source, path, (step, value) => {
          if (!Number.isFinite(value)) { started = false; return; }
          if (started) context.lineTo(x(step), y(value));
          else { context.moveTo(x(step), y(value)); started = true; }
        });
        context.stroke();
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    draw();
    // React state does not own theme changes or moving a window between different-DPR screens.
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    colorScheme.addEventListener("change", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      colorScheme.removeEventListener("change", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [source, width, height, x, y]);
  return <canvas ref={ref} className={styles.canvas} aria-hidden="true" data-simulation-path-canvas data-rendered-path-count={simulationFanPathCount(source)} />;
});
