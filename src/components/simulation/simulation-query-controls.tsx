"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { CalendarDays, ArrowRight } from "lucide-react";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";

export function SimulationLink(props: ComponentProps<typeof Link>) {
  const params = useSearchParams();
  let href = props.href;
  if (typeof href === "string" && href.startsWith("/simulation")) {
    const [path, search = ""] = href.split("?");
    const next = new URLSearchParams(search);
    for (const key of ["view", "preview"]) {
      const value = params.get(key);
      if (value && !next.has(key)) next.set(key, value);
    }
    href = `${path}?${next}`;
  }
  return <Link {...props} href={href} scroll={false} />;
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
    ].map((key) => [key, params.get(key)]),
  );
  return (
    <PortfolioAnalysisScopeTabs
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
      {["view", "preview"].map((key) =>
        params.get(key) ? (
          <input key={key} type="hidden" name={key} value={params.get(key)!} />
        ) : null,
      )}
    </>
  );
}

export function SimulationDateControl() {
  const params = useSearchParams();
  const router = useRouter();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const date = new FormData(event.currentTarget).get("end");
        const next = new URLSearchParams(params.toString());
        if (typeof date === "string" && date) next.set("end", date);
        else next.delete("end");
        router.push(`/simulation?${next}`, { scroll: false });
      }}
    >
      <label className="min-w-0 text-xs text-[var(--muted)]">
        <span className="mb-2 flex items-center gap-2">
          <CalendarDays size={14} aria-hidden="true" />
          기준일
        </span>
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
        className="flex min-h-10 items-center gap-2 rounded border border-[var(--line)] px-3 text-sm hover:bg-[var(--wash)]"
      >
        적용
        <ArrowRight size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="min-h-10 text-xs text-[var(--muted)] underline underline-offset-4"
        onClick={() => {
          const next = new URLSearchParams(params.toString());
          next.delete("end");
          router.push(`/simulation?${next}`, { scroll: false });
        }}
      >
        최신 공통 기준일
      </button>
    </form>
  );
}
