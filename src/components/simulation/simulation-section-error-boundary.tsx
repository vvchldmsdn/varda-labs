"use client";

import { unstable_catchError, type ErrorInfo } from "next/error";

type SimulationSectionErrorBoundaryProps = {
  section: string;
  title: string;
};

function SimulationSectionErrorFallback(
  { section, title }: SimulationSectionErrorBoundaryProps,
  { unstable_retry }: ErrorInfo,
) {
  return (
    <section
      aria-live="polite"
      className="border-b border-[#d7ddcf] py-5"
      data-simulation-section-error={section}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#687064]">
        이 분석만 불러오지 못했습니다. 다른 분석 결과는 계속 확인할 수
        있습니다.
      </p>
      <button
        className="mt-3 rounded-md border border-[#cfd5c8] bg-[#fbfcf7] px-3 py-2 text-sm font-semibold"
        onClick={() => unstable_retry()}
        type="button"
      >
        다시 시도
      </button>
    </section>
  );
}

export const SimulationSectionErrorBoundary = unstable_catchError(
  SimulationSectionErrorFallback,
);
