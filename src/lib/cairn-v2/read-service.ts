import { unavailableHeatmap, type BetaHeatmapRead } from "./heatmap-contract";
import { parseSaleExclusionKeys } from "../additional-contribution-sale-exclusions.ts";
import type { BetaContext, BetaCurrency } from "./navigation";
import {
  adaptBetaRead,
  blankDomainView,
  type DomainRead,
  type BetaHistoryRead,
} from "./read-contract.ts";
import type { SessionResolverResult } from "../session-resolver-contract";
import type { TenantPortfolioAnalysisScopeContextResult } from "../../db/queries/portfolio-analysis-scopes";
import type { DashboardData } from "../portfolio-dashboard";
import type { PortfolioStructureResult } from "../portfolio-structure";
import type { PortfolioAnalysisScope } from "../portfolio-analysis-scope";
import type { TenantContext } from "../session-resolver-contract";
import type { TenantApprovedTargetPolicyReadResult } from "../../db/queries/target-policy";
import { resolveSnapshotCycle } from "../snapshots/market-calendar.ts";
import {
  adaptTargets,
  adaptContribution,
  initialContribution,
  parseContributionInput,
  unavailableTargets,
  type TargetModel,
  type ContributionPreview,
} from "./planning-contract.ts";
type Params = Record<string, string | string[] | undefined>;
type ReadArgs = {
  serviceDate: string;
  scope: PortfolioAnalysisScope;
  analysisScopes: readonly PortfolioAnalysisScope[];
  tenantContext: TenantContext;
};
export type BetaReadPorts = {
  session: () => Promise<SessionResolverResult>;
  scopes: (args: {
    scope?: string | string[];
    account?: string | string[];
    tenantContext: TenantContext;
  }) => Promise<TenantPortfolioAnalysisScopeContextResult>;
  dashboard: (args: ReadArgs) => Promise<DashboardData>;
  structure: (args: ReadArgs) => Promise<PortfolioStructureResult>;
  heatmap?: (args: ReadArgs & { dashboard: DashboardData }) => Promise<BetaHeatmapRead>;
  history: (args: ReadArgs) => Promise<BetaHistoryRead>;
  targets?: (args: ReadArgs) => Promise<TargetModel>;
  contribution?: (
    args: ReadArgs & { cashAmountKrw: number; now: Date; excludedSellKeys?: readonly string[] },
  ) => Promise<ContributionPreview>;
  legacyPolicy?: (args: ReadArgs) => Promise<TenantApprovedTargetPolicyReadResult>;
  now?: () => Date;
};
export function domainContext(params: Params): BetaContext {
  return {
    mode: "domain",
    scope: typeof params.scope === "string" ? params.scope : "all",
    currency: params.currency === "USD" ? "USD" : "KRW",
    fixture: "standard",
    cashAmountKrw: params.cashAmountKrw,
    ...(params.excludeSell !== undefined ? { excludeSell: params.excludeSell } : {}),
    ...(params.analysis !== undefined ? { analysis: params.analysis } : {}),
    ...(params.window !== undefined ? { window: params.window } : {}),
    ...(params.horizon !== undefined ? { horizon: params.horizon } : {}),
    ...(params.end !== undefined ? { end: params.end } : {}),
    ...(params.run !== undefined ? { run: params.run } : {}),
  };
}
export function domainQueryContext(query: string) {
  const search = new URLSearchParams(query);
  const params: Params = {};
  for (const key of [
    "mode",
    "scope",
    "currency",
    "account",
    "fixture",
    "cashAmountKrw",
    "excludeSell",
    "analysis",
    "window",
    "horizon",
    "end",
    "run",
  ]) {
    const values = search.getAll(key);
    params[key] = values.length === 1 ? values[0] : values.length ? values : undefined;
  }
  return domainContext(params);
}
export function domainQueryValid(params: Params) {
  return (
    params.mode === "domain" &&
    params.fixture === undefined &&
    (params.currency === undefined || params.currency === "KRW" || params.currency === "USD") &&
    (params.scope === undefined ||
      (typeof params.scope === "string" &&
        params.scope.length > 0 &&
        params.scope === params.scope.trim())) &&
    params.account === undefined
  );
}
export async function readBetaDomain(params: Params, ports: BetaReadPorts): Promise<DomainRead> {
  const context = domainContext(params);
  let admittedScopes: NonNullable<DomainRead["view"]["domain"]>["scopes"] = [];
  const failed = (state: "unavailable" | "unauthorized", message: string) => ({
    context,
    view: {
      ...blankDomainView(state, message),
      domain: { ...blankDomainView(state, message).domain!, scopes: admittedScopes },
    },
  });
  if (!domainQueryValid(params)) return failed("unauthorized", "조회 조건이 올바르지 않습니다");
  try {
    const session = await ports.session();
    if (!session.ok)
      return failed(
        session.failure.httpStatus === 401 || session.failure.httpStatus === 403
          ? "unauthorized"
          : "unavailable",
        "사용자와 소유권 확인 전 · 조회하지 않음",
      );
    const scopeContext = await ports.scopes({
      scope: params.scope,
      account: params.account,
      tenantContext: session.tenantContext,
    });
    if (scopeContext.state !== "ready")
      return failed("unavailable", "소유 범위를 확인할 수 없습니다");
    admittedScopes = scopeContext.catalog.scopes.map((s) => ({
      key: s.key,
      label: s.label,
      detail:
        s.kind === "all" ? "소유 범위 전체" : s.kind === "account" ? "소유 계좌" : "소유 분석 범위",
    }));
    if (scopeContext.resolution.state !== "resolved")
      return failed("unauthorized", "허용되지 않은 조회 범위 · 전체 자산으로 대체하지 않음");
    const now = ports.now?.() ?? new Date();
    const serviceDate = resolveSnapshotCycle(now).snapshotDate;
    const args: ReadArgs = {
      serviceDate,
      scope: scopeContext.resolution.scope,
      analysisScopes: scopeContext.catalog.scopes,
      tenantContext: session.tenantContext,
    };
    // Optional planning failure never erases healthy valuation/history/structure reads.
    const targetPromise = ports.targets
      ? Promise.resolve()
          .then(() => ports.targets!(args))
          .then(
            (value) => ({ value }),
            () => ({ value: null }),
          )
      : Promise.resolve({ value: null });
    const dashboardPromise = ports.dashboard(args);
    const heatmapPromise = ports.heatmap
      ? dashboardPromise
          .then((dashboard) => ports.heatmap!({ ...args, dashboard }))
          .catch((error: unknown) => {
            const code =
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              typeof error.code === "string" &&
              /^[0-9A-Z]{5}$/.test(error.code)
                ? error.code
                : "read_failed";
            console.warn("[beta-heatmap] " + code);
            return unavailableHeatmap(args.scope.key);
          })
      : null;
    const results = await Promise.allSettled([
      dashboardPromise,
      ports.structure(args),
      ports.history(args),
    ]);
    if (results.some((r) => r.status !== "fulfilled"))
      return failed("unavailable", "읽기 조회 실패 · 예시로 대체하지 않음");
    const dashboard = (results[0] as PromiseFulfilledResult<DashboardData>).value;
    const structure = (results[1] as PromiseFulfilledResult<PortfolioStructureResult>).value;
    const history = (results[2] as PromiseFulfilledResult<BetaHistoryRead>).value;
    const acceptedContext = {
      ...context,
      scope: args.scope.key,
      currency: context.currency as BetaCurrency,
    };
    const view = adaptBetaRead({ dashboard, structure, history, context: acceptedContext });
    const input = parseContributionInput(params.cashAmountKrw);
    const before = (await targetPromise).value;
    let targets = before
      ? adaptTargets(before, acceptedContext, serviceDate, structure)
      : unavailableTargets();
    let contribution = initialContribution(acceptedContext, input);
    const saleSelection = parseSaleExclusionKeys(params.excludeSell);
    const selectionRows =
      before?.status === "ready"
        ? before.rows
            .filter((row) => row.currentValueKrw !== null && row.currentValueKrw > 0)
            .map((row) => ({
              key: row.accountId + ":" + row.assetId,
              label: row.assetName,
              detail: [row.accountName, row.ticker, row.market, row.currency]
                .filter(Boolean)
                .join(" · "),
            }))
        : [];
    const validSaleSelection =
      saleSelection.ok &&
      saleSelection.keys.every((key) =>
        before?.rows.some((row) => row.accountId + ":" + row.assetId === key),
      );
    if (!validSaleSelection)
      contribution = {
        ...contribution,
        state: "invalid",
        message:
          "매도 제외 선택이 현재 범위와 일치하지 않습니다. 선택을 확인해 다시 계산해 주세요.",
        blockers: ["invalid_sale_exclusions"],
      };
    if (
      validSaleSelection &&
      saleSelection.ok &&
      input.state === "ready" &&
      input.amount !== null &&
      context.currency === "KRW" &&
      before &&
      ports.targets &&
      ports.contribution
    ) {
      try {
        const legacyNeeded =
          before.policyValidation.status === "missing" && args.scope.kind === "account";
        const legacyBefore =
          legacyNeeded && ports.legacyPolicy ? await ports.legacyPolicy(args) : null;
        const preview = await ports.contribution({
          ...args,
          cashAmountKrw: input.amount,
          now,
          ...(saleSelection.ok && saleSelection.keys.length
            ? { excludedSellKeys: saleSelection.keys }
            : {}),
        });
        const after = await ports.targets(args);
        const legacyAfter =
          legacyNeeded && ports.legacyPolicy ? await ports.legacyPolicy(args) : null;
        contribution = adaptContribution({
          preview,
          before,
          after,
          legacyBefore,
          legacyAfter,
          targets,
          context: acceptedContext,
          serviceDate,
          input,
        });
        if (contribution.blockers.includes("planning_basis_changed"))
          targets = unavailableTargets("조회 중 정책·평가 근거 변경 · 새 조회 필요");
      } catch {
        contribution = {
          ...contribution,
          state: "unavailable",
          message: "추가 투자 조회 실패 · 기존 평가 읽기는 유지합니다",
        };
      }
    }
    view.domain = {
      ...view.domain!,
      planning: { targets, contribution: { ...contribution, selectionRows } },
    };
    if (heatmapPromise) view.domain.heatmap = await heatmapPromise;
    // Identity never goes to the client. Scope/currency/input are request-local; no cross-user cache.
    return { context: acceptedContext, view };
  } catch {
    return failed("unavailable", "읽기 조회 실패 · 예시로 대체하지 않음");
  }
}
