import Link from "next/link";

import type { PortfolioSetupProgress } from "@/lib/portfolio-setup-progress";

export function PortfolioSetupProgressPanel({
  progress,
}: {
  progress: PortfolioSetupProgress;
}) {
  if (progress.isComplete) return null;

  return (
    <section className="rounded-md border border-[#cfd9cb] bg-[#f7faf3] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#687064]">Portfolio setup</p>
          <h2 className="mt-1 text-lg font-semibold">
            {progress.completedStepCount}/3 steps complete
          </h2>
        </div>
        <Link
          className="rounded-md bg-[#1e3a34] px-4 py-2 text-sm font-semibold text-white hover:bg-[#17312c]"
          href={progress.nextAction.href}
        >
          {progress.nextAction.label}
        </Link>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {progress.steps.map((step) => (
          <li
            className="rounded-md border border-[#dfe3d5] bg-white p-3"
            key={step.id}
          >
            <p className="text-xs font-semibold uppercase text-[#687064]">
              {step.status}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#202721]">
              {step.label}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
