import type { ReactNode } from "react";
import { SimulationText } from "./simulation-text";

/** Evidence stays in the current overlay; expanding it does not create another dialog. */
export function SimulationDisclosure({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <details className="group border-b border-[var(--line)]">
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm font-medium text-[var(--ink)]"><SimulationText ko={title} /></span>
          {detail ? <span className="text-xs text-[var(--muted)]"><SimulationText ko={detail} /></span> : null}
        </span>
        <span aria-hidden="true" className="shrink-0 text-lg text-[var(--muted)] group-open:rotate-45 motion-safe:transition-transform">+</span>
      </summary>
      <div className="min-w-0 pb-5">{children}</div>
    </details>
  );
}
