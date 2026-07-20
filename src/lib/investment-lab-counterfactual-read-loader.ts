import {
  buildInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadModel,
  type InvestmentLabSourceCloseRow,
  type InvestmentLabSourceEventRow,
  type InvestmentLabSourceSnapshotRow,
} from "./investment-lab-counterfactual-read-model.ts";
import {
  composeInvestmentLabAllAccounts,
  notApplicableInvestmentLabAccountComposition,
  type InvestmentLabAccountComposition,
} from "./investment-lab-account-composition.ts";
import type { InvestmentLabVooFxRow } from "./investment-lab-voo-readiness.ts";
import type { InvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection.ts";
import {
  buildInvestmentLabRollingComparison,
  type InvestmentLabRollingComparison,
} from "./investment-lab-rolling-comparison.ts";
import {
  markInvestmentLabPeriodUnavailable,
  resolveInvestmentLabPeriodSelection,
  sliceInvestmentLabCounterfactualInput,
  type InvestmentLabPeriodRequest,
  type InvestmentLabPeriodSelection,
} from "./investment-lab-period-selection.ts";
import {
  loadInvestmentLabAnchorScenarios,
  type InvestmentLabAnchorBasketReadRepository,
  type InvestmentLabAnchorFountScope,
} from "./investment-lab-anchor-basket-read-loader.ts";
import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import type { InvestmentLabAnchorValueWeightScenario } from "./investment-lab-anchor-value-weight-scenario.ts";
import {
  listInvestmentLabCompleteSnapshotDates,
  listInvestmentLabLatestCurrentWriterDates,
} from "./investment-lab-source-segment-authority.ts";
import {
  applyInvestmentLabFountRuntimeScope,
  type InvestmentLabFountRuntimeEvidence,
  type InvestmentLabFountRuntimeScope,
} from "./investment-lab-fount-runtime-scope.ts";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";
import {
  buildInvestmentLabAllAccountFundingPreflight,
  buildInvestmentLabNamedAccountFundingPreflight,
  type InvestmentLabAccountFundingPreflight,
} from "./investment-lab-account-funding-preflight.ts";

export interface InvestmentLabCounterfactualReadRepository
  extends InvestmentLabAnchorBasketReadRepository {
  loadEvents(): Promise<readonly InvestmentLabSourceEventRow[]>;
  loadSnapshots(): Promise<readonly InvestmentLabSourceSnapshotRow[]>;
  loadScenarioCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadVooCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadFxRows(): Promise<readonly InvestmentLabVooFxRow[]>;
  loadFountRuntimeEvidence(
    serviceDates: readonly string[],
  ): Promise<InvestmentLabFountRuntimeEvidence>;
}

export async function loadInvestmentLabCounterfactualReadModel(
  repository: InvestmentLabCounterfactualReadRepository,
  request?: InvestmentLabPeriodRequest,
  fixedMixSelection?: InvestmentLabFixedMixSelection,
  requestedAnchorDate?: string | null,
  account: PortfolioAccountScope = "all",
): Promise<Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  period: InvestmentLabPeriodSelection;
  rollingComparison: InvestmentLabRollingComparison;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  fountScopeAdjustment: InvestmentLabFountRuntimeScope;
  accountComposition: InvestmentLabAccountComposition;
  fundingPreflight: InvestmentLabAccountFundingPreflight;
}>> {
  const [eventRows, snapshotRows, closeRows, vooCloseRows, fxRows] =
    await Promise.all([
      repository.loadEvents(),
      repository.loadSnapshots(),
      repository.loadScenarioCloses(),
      repository.loadVooCloses(),
      repository.loadFxRows(),
    ]);

  const input = Object.freeze({
    eventRows,
    snapshotRows,
    closeRows,
    vooCloseRows,
    fxRows,
  });
  const availableServiceDates = listInvestmentLabCompleteSnapshotDates(
    snapshotRows,
    account,
  );
  const period = resolveInvestmentLabPeriodSelection({
    request,
    availableServiceDates,
    defaultServiceDates: request
      ? undefined
      : listInvestmentLabLatestCurrentWriterDates(snapshotRows, account),
  });

  const selectedSource =
    period.status === "selected" || period.status === "current_writer"
      ? sliceInvestmentLabCounterfactualInput(input, period)
      : input;
  const fountServiceDates = listInvestmentLabCompleteSnapshotDates(
    selectedSource.snapshotRows,
    "all",
  );
  const fountEvidence =
    account === "irp" || account === "all"
      ? await repository.loadFountRuntimeEvidence(fountServiceDates)
      : ({ status: "not_applicable" } as const);
  const fountScope = applyInvestmentLabFountRuntimeScope({
    account,
    serviceDates: fountServiceDates,
    source: selectedSource,
    allEventRows: input.eventRows,
    evidence: fountEvidence,
  });
  const anchorFountScope = resolveAnchorFountScope(
    fountScope.scope.status,
    fountEvidence,
  );
  const pooledModel = buildInvestmentLabCounterfactualReadModel(
    fountScope.source,
    {
      account,
      fixedMixSelection,
      fountScopeAdjustmentStatus: fountScope.scope.status,
    },
  );
  const cachedAnchorRepository = cacheAnchorRepository(repository);
  let model = pooledModel;
  let accountComposition = notApplicableInvestmentLabAccountComposition();
  let anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  let anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  let fundingPreflight: InvestmentLabAccountFundingPreflight;

  if (account === "all") {
    const namedModels = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount) => [
          namedAccount,
          buildInvestmentLabCounterfactualReadModel(fountScope.source, {
            account: namedAccount,
            fixedMixSelection,
            fountScopeAdjustmentStatus:
              namedAccount === "irp"
                ? fountScope.scope.status
                : "not_applicable",
          }),
        ]),
      ) as Record<NamedPortfolioAccount, InvestmentLabCounterfactualReadModel>,
    );
    const [pooledAnchorScenarios, ...namedAnchorScenarioValues] =
      await Promise.all([
        loadInvestmentLabAnchorScenarios({
          account,
          repository: cachedAnchorRepository,
          model: pooledModel,
          source: fountScope.source,
          fxRows: fountScope.source.fxRows,
          requestedAnchorDate,
          fountScopeAdjustment: anchorFountScope,
        }),
        ...NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount) =>
          loadInvestmentLabAnchorScenarios({
            account: namedAccount,
            repository: cachedAnchorRepository,
            model: namedModels[namedAccount],
            source: fountScope.source,
            fxRows: fountScope.source.fxRows,
            requestedAnchorDate,
            fountScopeAdjustment:
              namedAccount === "irp"
                ? anchorFountScope
                : Object.freeze({ status: "not_applicable" }),
          }),
        ),
      ]);
    const namedAnchors = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount, index) => [
          namedAccount,
          namedAnchorScenarioValues[index].equalWeight,
        ]),
      ) as Record<NamedPortfolioAccount, InvestmentLabAnchorBasketScenario>,
    );
    const namedAnchorValueWeights = Object.freeze(
      Object.fromEntries(
        NAMED_PORTFOLIO_ACCOUNTS.map((namedAccount, index) => [
          namedAccount,
          namedAnchorScenarioValues[index].valueWeight,
        ]),
      ) as Record<
        NamedPortfolioAccount,
        InvestmentLabAnchorValueWeightScenario
      >,
    );
    const composed = composeInvestmentLabAllAccounts({
      pooledModel,
      namedModels,
      pooledAnchor: pooledAnchorScenarios.equalWeight,
      namedAnchors,
      pooledAnchorValueWeight: pooledAnchorScenarios.valueWeight,
      namedAnchorValueWeights,
    });
    model = composed.model;
    anchorBasketScenario = composed.anchorBasketScenario;
    anchorValueWeightScenario = composed.anchorValueWeightScenario;
    accountComposition = composed.composition;
    fundingPreflight = buildInvestmentLabAllAccountFundingPreflight({
      namedModels,
      namedAnchors,
      namedAnchorValueWeights,
      composition: composed.composition,
    });
  } else {
    const anchorScenarios = await loadInvestmentLabAnchorScenarios({
      account,
      repository: cachedAnchorRepository,
      model,
      source: fountScope.source,
      fxRows: fountScope.source.fxRows,
      requestedAnchorDate,
      fountScopeAdjustment: anchorFountScope,
    });
    anchorBasketScenario = anchorScenarios.equalWeight;
    anchorValueWeightScenario = anchorScenarios.valueWeight;
    fundingPreflight = buildInvestmentLabNamedAccountFundingPreflight({
      account,
      model,
      anchorBasketScenario,
      anchorValueWeightScenario,
    });
  }
  let resolvedPeriod = period;
  if (period.status === "selected") {
    const complete =
      model.observedPath.status === "ready" &&
      model.observedPath.summary.startServiceDate ===
        period.selectedStartServiceDate &&
      model.observedPath.summary.endServiceDate === period.selectedEndServiceDate;
    resolvedPeriod = complete
      ? period
      : markInvestmentLabPeriodUnavailable(period);
  }
  const rollingComparison = buildInvestmentLabRollingComparison({
    account,
    source: fountScope.source,
    availableServiceDates:
      model.observedPath.status === "ready"
        ? model.observedPath.rows.map((row) => row.serviceDate)
        : Object.freeze([]),
  });

  return Object.freeze({
    model,
    rollingComparison,
    period: resolvedPeriod,
    anchorBasketScenario,
    anchorValueWeightScenario,
    fountScopeAdjustment: fountScope.scope,
    accountComposition,
    fundingPreflight,
  });
}

function resolveAnchorFountScope(
  status: InvestmentLabFountRuntimeScope["status"],
  evidence: InvestmentLabFountRuntimeEvidence,
): InvestmentLabAnchorFountScope {
  if (status !== "applied") return Object.freeze({ status });
  if (evidence.status !== "ready") {
    return Object.freeze({ status: "blocked" });
  }
  return Object.freeze({ status: "applied", binding: evidence.binding });
}

function cacheAnchorRepository(
  repository: InvestmentLabAnchorBasketReadRepository,
): InvestmentLabAnchorBasketReadRepository {
  const positionReads = new Map<
    string,
    ReturnType<InvestmentLabAnchorBasketReadRepository["loadAnchorPositionRows"]>
  >();
  const priceReads = new Map<
    string,
    ReturnType<InvestmentLabAnchorBasketReadRepository["loadAnchorPriceRows"]>
  >();
  return Object.freeze({
    loadAnchorPositionRows(serviceDates: readonly string[]) {
      const key = serviceDates.join(",");
      const existing = positionReads.get(key);
      if (existing) return existing;
      const pending = repository.loadAnchorPositionRows(serviceDates);
      positionReads.set(key, pending);
      return pending;
    },
    loadAnchorPriceRows(
      input: Parameters<
        InvestmentLabAnchorBasketReadRepository["loadAnchorPriceRows"]
      >[0],
    ) {
      const key = JSON.stringify({
        instruments: input.instruments.map((instrument) => instrument.key),
        startServiceDate: input.startServiceDate,
        endServiceDate: input.endServiceDate,
      });
      const existing = priceReads.get(key);
      if (existing) return existing;
      const pending = repository.loadAnchorPriceRows(input);
      priceReads.set(key, pending);
      return pending;
    },
  });
}
