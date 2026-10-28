import type {BetaHeatmapRead} from "./heatmap-contract";
import { alignedInvestmentReturn } from "./investment-return";
import { historyObservationPoints, type HistoryReadRow } from "./history-observations.ts";
import type { BetaPlanningRead } from "./planning-contract";
import { buildPortfolioHistoryTrajectory } from "../history-trajectory.ts";
import type { DashboardData } from "../portfolio-dashboard";
import type { ReadOnlyHistoryBalance } from "../../db/queries/history-balance";
import type { PortfolioStructureResult } from "../portfolio-structure";
import type { BetaContext, BetaCurrency } from "./navigation";
import type { getFixtureView } from "./fixtures";
export type BetaHistoryRead = Omit<Pick<ReadOnlyHistoryBalance, "selectedScope" | "readStatus" | "portfolioRows">, "portfolioRows"> & { portfolioRows: HistoryReadRow[]; recoveredReturn?: import('../period-return-recovery').RecoveredReturnCurve | null; observationPolicy?: "production_observed_v1" };
export type DemoView = ReturnType<typeof getFixtureView>;
export type ReadState = "ready" | "empty" | "partial" | "unavailable" | "unauthorized" | "loading";
export type BetaView = Omit<DemoView, "rows" | "totalKrw" | "fxRate" | "drift" | "history"> & {
  history: (DemoView["history"][number] & { storageSnapshotDate?: string; valueSegment?: string; segment?: string; source?: string; rowKind?: string; account?: string; includedAccounts?: string[] })[];
  rows: (Omit<DemoView["rows"][number], "targetPct"> & { targetPct: number | null; ticker?: string | null; currency?: string; priceAsOf?: string | null; quantity?: number; currentPrice?: number })[];
  totalKrw: number | null; fxRate: number | null;
  drift: DemoView["drift"] | undefined;
  domain?: {
    recoveredReturn?: import('../period-return-recovery').RecoveredReturnCurve | null;
    investmentReturn?: import("./investment-return").InvestmentReturn;
    planning?: BetaPlanningRead;
    heatmap?: BetaHeatmapRead;
    state: ReadState; valueState: ReadState; historyState: ReadState; movementState: ReadState;
    knownSubtotalKrw: number | null; excluded: PortfolioStructureResult["exclusions"];
    rawDashboardTotalKrw: number | null; nonInvestmentCount: number; nonInvestmentValueKrw: number | null; valuationBasis: string; refreshedAt: string | null;
    priceObservedAt: (string | null)[]; snapshotDate: string | null; comparisonDate: string | null;
    movementSource: DashboardData["todayMovement"]["source"]; movementReason: string | null; movementReturnPct: number | null; movementExcludedCount: number; historySourceCount: number;
    historyRecords: HistoryReadRow[];
    historyObservationPolicy?: "production_observed_v1"; historyViewSource?: string; historyObservedExcludedCount?: number;
    historyReadStatus?: ReadOnlyHistoryBalance["readStatus"]; historyDisplayCurrency?: BetaCurrency;
    currentHoldingMovement?: Omit<import("../current-holding-movement").CurrentHoldingMovement, "rows"> & { rows: BetaMovementRow[] };
    movementRows?: BetaMovementRow[]; movementExclusions?: BetaMovementExclusion[];
    movementRead?: { ready: boolean; changeKrw: number | null; returnPct: number | null; includedCount: number; excludedCount: number; reasons: string[] };
    moneyBasis: { structure: { usdKrwRate: number | null; rateDate: null }; dashboard: { usdKrwRate: number | null; rateDate: string | null } };
    movementAmountBasis: "KRW_change_current_fx_translation"; movementReturnBasis: "KRW";
    weightBasis: "confirmed_subtotal"; currencyBasis: "KRW"; rateDate: string | null;
    scopes: { key: string; label: string; detail: string }[]; message: string;
  };
};
export type BetaMovementRow = Readonly<{
  key: string; name: string | null; ticker: string | null; account: string | null; accountLabel: string | null; market: string | null; currency: string | null;
  changeKrw: number; returnPct: number | null; previousValueKrw: number; tradeFlowKrw: number;
  source: DashboardData["todayMovement"]["contributionRows"][number]["source"]; identityStatus: "matched" | "unmatched";
}>;
export type BetaMovementExclusion = Pick<DashboardData["todayMovement"]["exclusions"][number], "subject" | "reason" | "source" | "ticker" | "assetName" | "account" | "currency" | "valueKrw">;
// Reuse the already-owned dashboard result. Internal holding/snapshot IDs are join keys only.
export function movementEvidenceRows(dashboard: DashboardData) {
  const holdings = new Map((dashboard.holdings ?? []).map(row => [row.id, row]));
  const labels = new Map((dashboard.accountSummaries ?? []).map(row => [row.code, row.label]));
  const occurrences = new Map<string, number>();
  const rows: BetaMovementRow[] = (dashboard.todayMovement.contributionRows ?? []).map((row) => {
    const holding = holdings.get(row.holdingId);
    const identity = JSON.stringify([holding?.account ?? null, holding?.market ?? null, holding?.currency ?? null, holding?.ticker ?? null, holding?.name ?? null]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { key: JSON.stringify([identity, occurrence]), name: holding?.name ?? null, ticker: holding?.ticker ?? null, account: holding?.account ?? null, accountLabel: holding ? labels.get(holding.account) ?? holding.account : null, market: holding?.market ?? null, currency: holding?.currency ?? null,
      changeKrw: row.changeKrw, returnPct: row.returnPct, previousValueKrw: row.previousValueKrw, tradeFlowKrw: row.tradeFlowKrw, source: row.source, identityStatus: holding ? 'matched' : 'unmatched' };
  });
  const exclusions: BetaMovementExclusion[] = dashboard.todayMovement.exclusions.map(row => ({subject:row.subject,reason:row.reason,source:row.source,ticker:row.ticker,assetName:row.assetName,account:row.account,currency:row.currency,valueKrw:row.valueKrw}));
  return { rows, exclusions };
}
export type DomainRead = { context: BetaContext; view: BetaView; readReceipt?: string; readEpoch?: string };
export const requestKey = (context: BetaContext) => JSON.stringify([context.mode, context.scope, context.currency, context.cashAmountKrw, ...(context.excludeSell!==undefined?[context.excludeSell]:[])]);
export function blankDomainView(state: ReadState, message: string): BetaView {
  return { rows: [], totalKrw: null, history: [], priceMoveKrw: 0, fxMoveKrw: 0, todayMoveKrw: null,
    drift: undefined, scopeLabel: "조회 범위", asOf: "확인 전", fxRate: null, contribution: [], scenario: [],
    domain: { state, valueState: state, historyState: state, movementState: state, knownSubtotalKrw: null,
      rawDashboardTotalKrw: null, nonInvestmentCount: 0, nonInvestmentValueKrw: null, excluded: [], valuationBasis: "기존 읽기 모델", refreshedAt: null, priceObservedAt: [],
      snapshotDate: null, comparisonDate: null, movementSource: null, movementReason: null, movementReturnPct: null, movementExcludedCount: 0, historySourceCount: 0,
      historyRecords: [], moneyBasis: { structure: { usdKrwRate: null, rateDate: null }, dashboard: { usdKrwRate: null, rateDate: null } }, movementAmountBasis: "KRW_change_current_fx_translation", movementReturnBasis: "KRW", weightBasis: "confirmed_subtotal", currencyBasis: "KRW", rateDate: null, scopes: [], message } };
}
// A pending URL never renders data from another scope/currency, even while an older RSC response exists.
export function visibleDomainRead(read: DomainRead, context: BetaContext): BetaView {
  return requestKey(read.context) === requestKey(context) ? read.view : blankDomainView("loading", "새 조회 범위를 확인하는 중");
}
export function adaptBetaRead({ dashboard, structure, history, context }: {
  dashboard: DashboardData; structure: PortfolioStructureResult; history: BetaHistoryRead; context: BetaContext;
}): BetaView {
  const movementEvidence = movementEvidenceRows(dashboard);
  const currentHoldingMovement = dashboard.currentHoldingMovement ? { ...dashboard.currentHoldingMovement, rows: movementEvidenceRows({ ...dashboard, todayMovement: { ...dashboard.todayMovement, contributionRows: dashboard.currentHoldingMovement.rows } }).rows } : undefined;
  const excluded = structure.exclusions;
  const partial = excluded.length > 0;
  const empty = structure.dataHealth.selectedAssetCount === 0;
  const reportingFxMissing = context.currency === "USD" && !(structure.usdKrwRate !== null && structure.usdKrwRate > 0);
  const valueState: ReadState = empty ? "empty" : reportingFxMissing ? "unavailable" : partial ? "partial" : "ready";
  const view = blankDomainView("ready", "");
  // The structure engine already computed exclusions, subtotal and weights. Never normalize excluded assets away here.
  view.rows = structure.holdingRows.map((row, i) => ({
    key: JSON.stringify([row.account, row.market, row.currency, row.ticker, row.name]), ticker: row.ticker,
    name: row.name, account: row.account, currency: row.currency, priceAsOf: row.priceAsOf, quantity: row.quantity, currentPrice: row.currentPrice,
    weightPct: row.currentWeightPct, targetPct: null, valueKrw: row.currentValueKrw,
    priceMove: 0, fxMove: 0, color: ["#ef5a32", "#343932", "#cca17b", "#8c9f89", "#697f8c"][i % 5], heatmap: [],
  }));
  view.totalKrw = empty || partial || reportingFxMissing ? null : structure.totalValueKrw;
  view.fxRate = structure.usdKrwRate !== null && structure.usdKrwRate > 0 ? structure.usdKrwRate : null;
  view.scopeLabel = dashboard.selectedScope.label;
  view.asOf = dashboard.generatedAt;
  // KRW saved records lack historical reporting FX. Do not rewrite them with today's rate.
  const historyCurrencySupported = context.currency === "KRW";
  const trajectory = buildPortfolioHistoryTrajectory({ rows: history.portfolioRows, account: history.selectedScope.key });
  const observed = history.observationPolicy === "production_observed_v1" ? historyObservationPoints(history.portfolioRows, true) : null;
  const ambiguousHistory = !observed && (trajectory.sourceCount > 1 || trajectory.ambiguousPointCount > 0);
  view.history = history.portfolioRows.map(row => ({ date: row.snapshotDate, source: row.source, rowKind: row.rowKind, account: row.account, includedAccounts: [...row.derivedFromAccounts],
    segment: trajectory.segments.find(s => s.source === row.source && s.rowKind === row.rowKind && s.points.some(p => p.date === row.snapshotDate))?.key ?? row.snapshotDate,
    valueKrw: historyCurrencySupported && !ambiguousHistory ? row.totalMarketValue : null,
    exampleReturnPct: historyCurrencySupported && !ambiguousHistory && row.rowKind !== "partial" ? row.totalReturnPct : null,
  })).sort((a, b) => a.date.localeCompare(b.date));
  if (observed && historyCurrencySupported) view.history = observed.rows;
  // Price/FX decomposition is not independently exposed by this contract: do not synthesize it.
  view.todayMoveKrw = empty || (context.currency === "USD" && !(dashboard.usdKrwRate > 0)) || partial || dashboard.todayMovement.exclusions.length > 0 || !dashboard.todayMovement.ready ? null : dashboard.todayChangeKrw;
  const movementState: ReadState = empty ? "empty" : view.todayMoveKrw === null ? "unavailable" : "ready";
  const historyState: ReadState = !historyCurrencySupported || ambiguousHistory || history.readStatus === "unavailable" ? "unavailable" :
    !history.portfolioRows.length ? "empty" : observed && !observed.rows.length ? "unavailable" : history.readStatus === "partial" || history.portfolioRows.some(r => r.rowKind === "partial") ? "partial" : "ready";
  view.domain = { ...view.domain!, state: valueState === "unavailable" ? "unavailable" : empty ? "empty" :
      partial || historyState !== "ready" || movementState !== "ready" ? "partial" : "ready",
    investmentReturn: alignedInvestmentReturn(dashboard, structure),
    valueState, historyState, movementState, excluded, knownSubtotalKrw: empty ? null : structure.totalValueKrw,
    rawDashboardTotalKrw: dashboard.totalValueKrw, nonInvestmentCount: dashboard.nonInvestmentAssets.length, nonInvestmentValueKrw: dashboard.nonInvestmentTotalKrw, refreshedAt: dashboard.generatedAt,
    priceObservedAt: structure.holdingRows.map(r => r.priceAsOf),
    valuationBasis: partial ? "확인 가능한 자산 소계 · 제외 자산 별도" : "현재 투자자산 평가 · 기존 구조 read model",
    snapshotDate: dashboard.movementBaselineDate, comparisonDate: dashboard.marketPriceReferenceDate,
    movementSource: dashboard.todayMovement.source, movementReason: dashboard.todayMovement.reason, movementReturnPct: view.todayMoveKrw === null ? null : dashboard.todayMovement.returnPct, movementExcludedCount: dashboard.todayMovement.exclusions.length, historySourceCount: trajectory.sourceCount,
    recoveredReturn: history.recoveredReturn, historyRecords: history.portfolioRows, historyObservationPolicy: history.observationPolicy, historyViewSource: observed ? "observed" : undefined, historyObservedExcludedCount: observed?.excludedCount, historyReadStatus: history.readStatus, historyDisplayCurrency: context.currency,
    currentHoldingMovement,
    movementRows: movementEvidence.rows, movementExclusions: movementEvidence.exclusions,
    movementRead: { ready: dashboard.todayMovement.ready, changeKrw: dashboard.todayMovement.changeKrw ?? null, returnPct: dashboard.todayMovement.returnPct, includedCount: dashboard.todayMovement.contributionRows?.length ?? 0, excludedCount: dashboard.todayMovement.exclusions.filter(row => row.subject !== "aggregate").length, reasons: [...new Set(dashboard.todayMovement.exclusions.map(row => row.reason))] }, rateDate: null,
    moneyBasis: { structure: { usdKrwRate: view.fxRate, rateDate: null }, dashboard: { usdKrwRate: dashboard.usdKrwRate > 0 ? dashboard.usdKrwRate : null, rateDate: dashboard.dataHealth.latestFxRateDate } },
    scopes: dashboard.analysisScopes.map(s => ({ key: s.key, label: s.label, detail: s.kind === "all" ? "소유 범위 전체" : s.kind === "account" ? "소유 계좌" : "소유 분석 범위" })),
    message: reportingFxMissing ? "보고 통화 환율 없음" : partial ? "평가 불가 자산 포함 · 전체 합계 확인 전" :
      ambiguousHistory ? "서로 다른 저장 이력 근거 · 기존 히스토리에서 확인" : !historyCurrencySupported ? "USD 저장 평가·수익률 환산 근거 없음" : empty ? "보유 자산 없음" : "기존 읽기 모델 · 저장 이력과 현재 평가를 구분",
  };
  return view;
}
export function displayReadMoney(view: BetaView, krw: number | null, currency: BetaCurrency, signed = false, source: "structure" | "dashboard" = "structure") {
  if (krw === null || !Number.isFinite(krw)) return "—";
  const rate = currency === "KRW" ? 1 : view.domain ? view.domain.moneyBasis[source].usdKrwRate : view.fxRate;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return "—";
  const value = krw / rate;
  return `${signed && value > 0 ? "+" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: currency === "USD" ? 2 : 0 })}`;
}
