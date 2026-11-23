"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button, Status } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { startBoundedRead } from "@/lib/cairn-v2/bounded-read";
import { formatLiveValuationTime, historyObservationDate } from "@/lib/cairn-v2/history-date";
import { HISTORY_BINDING_HEADER, homeHistoryGeneration } from "@/lib/cairn-v2/home-history-read";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { MAX_PERFORMANCE_DAYS, type PeriodPerformance } from "@/lib/cairn-v2/period-performance";
import { reviewedPerformance } from "@/lib/cairn-v2/reviewed-history-series";
import type { BetaView, DomainRead } from "@/lib/cairn-v2/read-contract";
import { historyWindowStart, type HistoryPeriod } from "@/lib/cairn-v2/read-presentation";
import { currentKstDate } from "@/lib/current-kst-date";
import { buildCycleForSnapshotDate } from "@/lib/snapshots/market-calendar";
import { useBetaPreferences } from "./beta-provider";
import styles from "./beta.module.css";

type Read = { status: "ready" | "loading" | "empty" | "error"; data: PeriodPerformance | null; message?: [string, string]; retryable?: boolean; limitedHistory?: boolean };
const Context = createContext<(Read & { retry: () => void }) | null>(null);
export const usePeriodPerformance = () => useContext(Context);
const pending: Read = { status: "loading", data: null };

/** Keep the server's compounded return, basis date and break markers when zooming. */
export function visiblePerformance(data: PeriodPerformance, period: HistoryPeriod): PeriodPerformance {
  if (period === "ALL") return data;
  const windowStart = historyWindowStart(data.range.end, period);
  if (windowStart <= data.range.start) return data;
  return { ...data, range: { ...data.range, start: windowStart },
    points: data.points.filter(point => point.date >= windowStart),
    gaps: data.gaps.filter(gap => gap.end >= windowStart).map(gap =>
      gap.start < windowStart ? { ...gap, start: windowStart } : gap),
  };
}

export function nextPerformanceReadAt(now: Date, missingClose: boolean) {
  const today = currentKstDate(now);
  const midnight = Date.parse(today + "T00:00:00+09:00") + 86_400_000;
  if (!missingClose) return midnight;
  // The 07:00 KST closing job can run for five minutes or start late.
  const close = buildCycleForSnapshotDate(today, now).cycleEndAt.getTime();
  return [close + 5 * 60_000, close + 65 * 60_000].find(time => time > now.getTime()) ?? midnight;
}

function earliestPerformanceDate(view: BetaView, end: string) {
  const domain = view.domain;
  if (!domain) return;
  const dates = [domain.accountHistoryReview?.startDate, domain.recoveredReturn?.baseDate, ...view.history.map(row => row.date)];
  for (const row of domain.historyRecords) {
    const date = historyObservationDate(row);
    // Native 07:00 cutoffs can use the next calendar day's storage key.
    // Let the server choose the financial date from its actual frame.
    if (date && row.source.startsWith("saved_source:")) {
      dates.push(new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10));
    } else dates.push(date ?? undefined);
  }
  return dates.reduce<string | undefined>((first, date) =>
    date && date <= end && (!first || date < first) ? date : first, undefined);
}

export function HomePerformanceProvider({ view, context, read, children }: {
  view: BetaView; context: BetaContext; read?: DomainRead; children: ReactNode;
}) {
  const { metric, period } = useBetaPreferences();
  const binding = read?.displayBinding;
  const scope = context.scope;
  const domain = view.domain;
  const active = metric === "return" && !!binding && !!domain && context.mode === "domain";
  const authorized = active && read.context.scope === scope && read.context.currency === context.currency &&
    domain.state !== "loading" && domain.state !== "unauthorized";
  const now = new Date();
  const end = currentKstDate(now);
  const oldest = active ? earliestPerformanceDate(view, end) : undefined;
  const group = scope.startsWith("portfolio:");
  const earliestAllowed = new Date(Date.parse(end) - (MAX_PERFORMANCE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const limitedHistory = !!oldest && oldest < earliestAllowed;
  const start = limitedHistory ? earliestAllowed : oldest;
  const rangeUnavailable = limitedHistory && period === "ALL";
  const readingAll = domain?.historyState === "loading";
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([homeHistoryGeneration(context, read), start, end, attempt]);
  const [result, setResult] = useState<{ key: string; value: Read } | null>(null);
  const current = result?.key === key ? result.value : null;
  const ready = current?.status === "ready";
  const cycle = buildCycleForSnapshotDate(end, now);
  const expectedCloseDate = currentKstDate(cycle.cycleStartAt);
  const missingClose = !current?.data || current.data.points.some(point => point.date === expectedCloseDate && !!point.liveAsOf) ||
    current.data.gaps.some(gap => gap.reason === "valuation" && gap.start <= expectedCloseDate && expectedCloseDate <= gap.end);
  useEffect(() => {
    if (!authorized || group) return;
    let timer: number;
    const wake = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      setAttempt(previous => previous + 1);
      schedule();
    };
    function schedule() {
      const now = new Date();
      timer = window.setTimeout(wake, nextPerformanceReadAt(now, missingClose) - now.getTime());
    }
    // Only read already stored evidence. Waking a tab never starts quote collection.
    schedule();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [authorized, group, missingClose]);
  useEffect(() => {
    if (!authorized || !binding || group || !start || readingAll || rangeUnavailable || ready) return;
    let mounted = true;
    const request = startBoundedRead<Read>(async signal => {
      const query = new URLSearchParams({ metric: "return", scope, start, end });
      const response = await fetch("/beta/api/history/period-attribution?" + query, {
        credentials: "same-origin", cache: "no-store", signal, headers: { [HISTORY_BINDING_HEADER]: binding },
      });
      if ([401, 403, 409].includes(response.status) || response.ok && response.headers.get(HISTORY_BINDING_HEADER) !== binding)
        return { status: "error", data: null, message: ["현재 계좌를 다시 확인해 주세요.", "Please check the selected account."], retryable: true };
      if (!response.ok) throw new Error("performance_read_failed");
      const data: PeriodPerformance = await response.json();
      if (data.currency !== "KRW" || data.range.start !== start || data.range.end !== end ||
          !Array.isArray(data.points) || !Array.isArray(data.gaps)) throw new Error("performance_range_mismatch");
      return { status: "ready", data };
    });
    void request.promise.then(value => {
      if (mounted) setResult({ key, value });
    }, () => {
      if (mounted) setResult({ key, value: { status: "error", data: null, message: ["수익률을 불러오지 못했어요.", "Could not load returns."], retryable: true } });
    });
    return () => { mounted = false; request.cancel(); };
  }, [authorized, binding, end, group, key, rangeUnavailable, readingAll, ready, scope, start]);
  const review = authorized && context.currency === "KRW" && scope.startsWith("account:") ? domain.accountHistoryReview : null;
  const data = current?.data ? visiblePerformance(review ? reviewedPerformance(current.data, review) : current.data, period) : null;
  let state = current ?? pending;
  if (!authorized || readingAll) state = pending;
  else if (group) state = { status: "error", data: null, message: ["기간 수익률을 볼 계좌를 선택해 주세요.", "Select an account to view period returns."] };
  else if (rangeUnavailable) state = { status: "error", data: null, message: ["10년이 넘는 기록이에요. 더 짧은 기간을 선택해 주세요.", "Select a shorter period for histories over ten years."] };
  else if (!start) state = { status: "empty", data: null, message: ["기간을 정할 수 있는 평가 기록이 없어요.", "No dated valuations are available for this period."] };
  else if (current?.status === "ready") state = { ...current, data, limitedHistory };
  if (domain?.state === "unauthorized") state = { status: "error", data: null, message: ["계좌 조회 권한을 다시 확인해 주세요.", "Please verify access to this account."] };
  const retry = () => setAttempt(previous => previous + 1);
  return <Context.Provider value={active ? { ...state, retry } : null}>{children}</Context.Provider>;
}

export function PerformanceStatus() {
  const read = usePeriodPerformance();
  const { t } = useI18n();
  return <Status as="div" role="status" className={styles.empty}>
    {read?.message ? t(...read.message) : t("거래와 평가 기록을 확인하고 있어요.", "Checking trades and valuations.")}
    {read?.retryable && <Button type="button" variant="bare" onClick={read.retry}>{t("다시 조회", "Retry")}</Button>}
  </Status>;
}

export function PerformanceCaption({ data, empty = false }: { data: PeriodPerformance; empty?: boolean }) {
  const { t } = useI18n();
  const read = usePeriodPerformance();
  if (empty) return <Status as="div" role="status" className={styles.empty}>{data.basis === "mixed"
    ? t("평가 기준이 다른 계좌예요. 개별 계좌를 선택해 주세요.", "Select an individual account with a consistent valuation basis.")
    : t("이 기간에는 수익률을 계산할 거래·평가 기록이 부족해요.", "There are insufficient trade or valuation records for this period.")}</Status>;
  const last = data.points.findLast(point => point.returnPct !== null && point.date !== point.segment);
  return <p className={styles.muted}>
    {data.basis === "invested_assets_excluding_cash"
      ? t("투자자산 누적 수익률 · 원화", "Cumulative invested asset return · KRW") : t("계좌 누적 수익률 · 원화", "Cumulative account return · KRW")}
    {last?.segment && t(" · " + last.segment.replaceAll("-", ".") + " 기준", " · since " + last.segment)}
    {read?.limitedHistory && t(" · 최근 10년 내 확인 구간", " · verified within the last 10 years")}
    {data.includesClosingFx && t(" · 일부 환율 추정", " · some trades use valuation FX")}
    {data.includesCarriedMarks && t(" · 일부 최근 확인가", " · some prior marks")}
    {last?.liveAsOf && <> · <time dateTime={last.liveAsOf}>{t("잠정", "Provisional")} {formatLiveValuationTime(last.liveAsOf)}</time></>}
  </p>;
}
