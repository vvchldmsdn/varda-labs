"use client";

import { SimulationText } from "@/components/simulation/simulation-text";


import Link, { useLinkStatus } from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useTransition, type ComponentProps, type ReactNode } from "react";
import { CalendarDays, ArrowRight } from "lucide-react";
import loadingStyles from "./simulation-loading.module.css";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";

const SimulationTransitionContext = createContext<ReturnType<typeof useTransition> | null>(null);

/** Keep a date navigation pending even if its settings dialog is dismissed. */
export function SimulationNavigationBoundary({ children, className }: { children: ReactNode; className?: string }) {
  const transition = useTransition();
  return <SimulationTransitionContext value={transition}>
    <div className={className} data-simulation-link-pending={transition[0] || undefined}>{children}</div>
  </SimulationTransitionContext>;
}

export function SimulationLink(props: ComponentProps<typeof Link>) {
  const params = useSearchParams();
  let href = props.href;
  if (typeof href === "string" && href.startsWith("/simulation")) {
    const [path, search = ""] = href.split("?");
    const next = new URLSearchParams(search);
    for (const key of ["view", "preview", "model"]) {
      const value = params.get(key);
      if (value && !next.has(key)) next.set(key, value);
    }
    href = `${path}?${next}`;
  }
  return <Link {...props} className={`${props.className ?? ""} ${loadingStyles.link}`} href={href} prefetch={false} scroll={false}>{props.children}<SimulationPendingHint /></Link>;
}

function SimulationPendingHint() {
  const { pending } = useLinkStatus();
  return <span className={loadingStyles.pendingHint} data-simulation-link-pending={pending || undefined}>
    {pending ? <span role="status" className="sr-only"><SimulationText ko="계산 조건을 적용하고 있습니다." en="Applying your simulation settings." /></span> : null}
  </span>;
}

export function SimulationScopeTabs({
  scopes,
  selectedScopeKey,
}: {
  scopes: readonly PortfolioAnalysisScope[];
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  const params = useSearchParams();
  const query = Object.fromEntries(
    [
      "view",
      "end",
      "horizon",
      "kodexWeight",
      "researchUniverse",
      "preview",
      "model",
    ].map((key) => [key, params.get(key)]),
  );
  return (
    <PortfolioAnalysisScopeTabs
      linkComponent={SimulationLink}
      basePath="/simulation"
      scopes={scopes}
      selectedScopeKey={selectedScopeKey}
      query={query}
      variant="underline"
    />
  );
}

export function SimulationContextFields() {
  const params = useSearchParams();
  return (
    <>
      {["view", "preview", "model"].map((key) =>
        params.get(key) ? (
          <input key={key} type="hidden" name={key} value={params.get(key)!} />
        ) : null,
      )}
    </>
  );
}

export function SimulationModelSelector() {
  const params = useSearchParams();
  const selected = params.get("model") ?? "economic";
  return <nav aria-label="Simulation model" className="flex min-w-0 gap-1 rounded-md bg-[var(--wash)] p-1" data-simulation-model-selector>
    {(["economic", "bootstrap"] as const).map((model) => {
      const next = new URLSearchParams(params.toString());
      next.set("model", model);
      return <SimulationLink key={model} href={`/simulation?${next}`} aria-current={selected === model ? "page" : undefined}
        className={`min-h-10 rounded px-3 py-2 text-xs transition-colors ${selected === model ? "bg-[var(--paper)] font-medium text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
        <SimulationText ko={model === "economic" ? "경제지표 경로" : "과거 수익률 경로"} en={model === "economic" ? "Economic paths" : "Historical paths"} />
      </SimulationLink>;
    })}
  </nav>;
}

export function SimulationDateControl() {
  const params = useSearchParams();
  const router = useRouter();
  const localTransition = useTransition();
  const [pending, startTransition] = useContext(SimulationTransitionContext) ?? localTransition;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      data-simulation-link-pending={pending || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        const date = new FormData(event.currentTarget).get("end");
        const next = new URLSearchParams(params.toString());
        if (typeof date === "string" && date) next.set("end", date);
        else next.delete("end");
        startTransition(() => router.push(`/simulation?${next}`, { scroll: false }));
      }}
    >
      <label className="min-w-0 text-xs text-[var(--muted)]">
        <span className="mb-2 flex items-center gap-2">
          <CalendarDays size={14} aria-hidden="true" />
          <SimulationText ko={"기준일"} />{" "}</span>
        <input
          key={params.get("end") ?? "latest"}
          type="date"
          name="end"
          defaultValue={params.get("end") ?? ""}
          className="min-h-10 max-w-full rounded border border-[var(--line)] bg-transparent px-3 text-sm text-[var(--ink)] focus-visible:outline-[var(--brand)]"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-10 items-center gap-2 rounded border border-[var(--line)] px-3 text-sm hover:bg-[var(--wash)]"
      >
        <SimulationText ko={pending ? "계산 중" : "적용"} en={pending ? "Calculating" : "Apply"} />{" "}<ArrowRight size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={pending}
        className="min-h-10 text-xs text-[var(--muted)] underline underline-offset-4"
        onClick={() => {
          const next = new URLSearchParams(params.toString());
          next.delete("end");
          startTransition(() => router.push(`/simulation?${next}`, { scroll: false }));
        }}
      >
        <SimulationText ko={"최신 공통 기준일"} />{" "}</button>
      {pending ? <span className={loadingStyles.inlineStatus} role="status"><span className={loadingStyles.spinner} aria-hidden="true" /><SimulationText ko="새 기준으로 계산하고 있습니다." en="Recalculating for the selected cutoff." /></span> : null}
    </form>
  );
}
