import Link from "next/link";

import type { PortfolioSetupProgress } from "@/lib/portfolio-setup-progress";

export function PortfolioSetupProgressPanel({
  progress,
}: {
  progress: PortfolioSetupProgress;
}) {
  if (progress.isComplete) return null;

  return (
    <section className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">Portfolio setup</p>
          <h2 className="mt-1 text-lg font-semibold">
            {progress.completedStepCount}/3 steps complete
          </h2>
        </div>
        <Link
          className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ink)]"
          href={progress.nextAction.href}
        >
          {progress.nextAction.label}
        </Link>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {progress.steps.map((step) => (
          <li
            className="rounded-md border border-[var(--line)] bg-white p-3"
            key={step.id}
          >
            <p className="text-xs font-semibold uppercase text-[var(--muted)]">
              {step.status}
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
              {step.label}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
