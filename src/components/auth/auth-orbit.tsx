"use client";

import { useRef, type PointerEvent } from "react";
import styles from "./auth-experience.module.css";

const rings = [42, 70, 98, 126];

/** A decorative brand figure, never a representation of financial data. */
export function AuthOrbit() {
  const figureRef = useRef<HTMLDivElement>(null);

  function move(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    figureRef.current?.style.setProperty("--orbit-x", `${x * 14}px`);
    figureRef.current?.style.setProperty("--orbit-y", `${y * 14}px`);
  }

  function reset() {
    figureRef.current?.style.setProperty("--orbit-x", "0px");
    figureRef.current?.style.setProperty("--orbit-y", "0px");
  }

  return (
    <div ref={figureRef} className={styles.orbit} aria-hidden="true" onPointerMove={move} onPointerLeave={reset}>
      <svg viewBox="0 0 360 290" fill="none">
        <g className={styles.orbitDots}>
          {rings.flatMap((radius, ring) => Array.from({ length: 18 + ring * 14 }, (_, index) => {
            const angle = index / (18 + ring * 14) * Math.PI * 2;
            return <circle key={`${ring}-${index}`} cx={(180 + Math.cos(angle) * radius).toFixed(3)} cy={(145 + Math.sin(angle) * radius).toFixed(3)}
              r={2.4} fill="currentColor" opacity={.23 + ring * .16} style={{ animationDelay: `${ring * 65 + index * 3}ms` }} />;
          }))}
        </g>
        <circle className={styles.orbitFocus} cx="180" cy="145" r="19" fill="var(--accent)" />
        <circle className={styles.orbitSatellite} cx="276" cy="60" r="7" fill="var(--accent)" />
      </svg>
    </div>
  );
}
