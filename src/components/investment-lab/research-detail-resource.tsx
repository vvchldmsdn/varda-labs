"use client";

import { LabText } from "./lab-text";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/** URL history changes select details without requesting the main page again. */
export function useResearchPanelNavigation<T extends string>(resolve: (value: unknown) => T | null) {
  const params = useSearchParams();
  const values = params.getAll("view");
  const panel = resolve(values.length === 1 ? values[0] : null);
  function select(nextPanel: T | null) {
    const url = new URL(window.location.href);
    if (nextPanel) url.searchParams.set("view", nextPanel);
    else url.searchParams.delete("view");
    const href = `${url.pathname}${url.search}${url.hash}`;
    if (nextPanel) window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
  }
  return { panel, select, query: params.toString() };
}

/** Component-local, abortable read. Responses never outlive their request identity. */
export function useResearchDetail<T>(endpoint: string, query: string) {
  const url = `${endpoint}?${query}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const key = `${url}#${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    fetch(url, { signal: controller.signal, credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
          ? "로그인과 분석 범위 권한을 확인한 뒤 다시 시도해 주세요."
          : "상세 분석을 읽지 못했습니다. 다시 시도해 주세요.");
        return await response.json() as T;
      })
      .then((data) => { if (current) setResult({ key, data }); })
      .catch((error: unknown) => {
        if (current && !controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "상세 분석을 읽지 못했습니다." });
      });
    return () => { current = false; controller.abort(); };
  }, [url, key]);
  return { data: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined, retry: () => setAttempt((value) => value + 1) };
}

export function ResearchDetailStatus({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <div role="alert" className="space-y-4 py-8 text-sm text-[var(--warning)]"><p><LabText value={error} /></p><button type="button" onClick={retry} className="varda-action"><LabText value="다시 시도" /></button></div>
    : <p role="status" className="motion-safe:animate-pulse py-10 text-sm text-[var(--muted)]"><LabText value="선택한 분석을 계산하고 있습니다." /></p>;
}
