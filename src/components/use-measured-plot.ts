"use client";

import { useEffect, useState } from "react";

/** Keep SVG coordinates in CSS pixels; do not stretch a precomputed chart. */
export function useMeasuredPlot() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setSize(previous => previous.width === width && previous.height === height
        ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [size, setElement] as const;
}
