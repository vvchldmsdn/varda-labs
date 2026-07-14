import {
  groupEtfHoldingRows,
  type EtfHoldingRawRow,
} from "./etf-holdings.ts";
import type { PortfolioStructureHoldingRow } from "./portfolio-structure.ts";
import { toNumber } from "./portfolio-math.ts";
import {
  buildDirectPortfolioWeights,
  instrumentIdentityKey,
  resolveInvestmentLabEtfCandidates as resolveEtfCandidates,
  type ResolvedInvestmentLabEtfCandidate as ResolvedEtfCandidate,
} from "./investment-lab-etf-xray-candidates.ts";
import type {
  InvestmentLabEtfXrayComponentRow,
  InvestmentLabEtfXrayEtfRow,
  InvestmentLabEtfXrayMasterInput,
  InvestmentLabEtfXrayModel,
  InvestmentLabEtfXrayStatus,
} from "./investment-lab-etf-xray-types.ts";

export { selectInvestmentLabEtfXrayMasterIds } from "./investment-lab-etf-xray-candidates.ts";
export type {
  InvestmentLabEtfXrayComponentRow,
  InvestmentLabEtfXrayEtfRow,
  InvestmentLabEtfXrayMasterInput,
  InvestmentLabEtfXrayModel,
  InvestmentLabEtfXrayStatus,
} from "./investment-lab-etf-xray-types.ts";

const COVERAGE_EPSILON = 0.000001;

export function buildInvestmentLabEtfXray(input: {
  portfolioHoldings: readonly PortfolioStructureHoldingRow[];
  masters: readonly InvestmentLabEtfXrayMasterInput[];
  holdingEvidence: readonly EtfHoldingRawRow[];
}): InvestmentLabEtfXrayModel {
  const candidates = resolveEtfCandidates(
    input.portfolioHoldings,
    input.masters,
  );
  const directWeights = buildDirectPortfolioWeights(input.portfolioHoldings);
  const evidenceByMaster = groupEvidenceByMaster(input.holdingEvidence);
  const mutableComponents = new Map<string, MutableComponent>();
  const etfRows = candidates.map((candidate) =>
    buildEtfRow(candidate, evidenceByMaster, mutableComponents),
  );
  const componentRows = [...mutableComponents.entries()]
    .map(([key, component]) =>
      finalizeComponentRow(key, component, directWeights),
    )
    .filter((row) => row.portfolioExposurePct > COVERAGE_EPSILON)
    .sort(compareComponentRows);
  const etfPortfolioWeightPct = sum(
    etfRows.map((row) => row.portfolioWeightPct),
  );
  const observedPortfolioExposurePct = sum(
    componentRows.map((row) => row.portfolioExposurePct),
  );
  const uncoveredPortfolioExposurePct = Math.max(
    0,
    etfPortfolioWeightPct - observedPortfolioExposurePct,
  );
  const asOfDates = Object.freeze(
    [...new Set(etfRows.flatMap((row) => (row.asOfDate ? [row.asOfDate] : [])))].sort(),
  );
  const missingReferenceCount = etfRows.filter(
    (row) => row.mappingStatus === "missing_reference",
  ).length;
  const ambiguousReferenceCount = etfRows.filter(
    (row) => row.mappingStatus === "ambiguous_reference",
  ).length;
  const hasCoverageGaps =
    missingReferenceCount > 0 ||
    ambiguousReferenceCount > 0 ||
    etfRows.some((row) => row.evidenceStatus !== "complete") ||
    uncoveredPortfolioExposurePct > COVERAGE_EPSILON;
  const mixedAsOfDates = asOfDates.length > 1;
  const status: InvestmentLabEtfXrayStatus =
    etfRows.length === 0
      ? "unavailable"
      : hasCoverageGaps
        ? "partial"
        : mixedAsOfDates
          ? "complete_mixed_dates"
          : "complete_common_date";

  return Object.freeze({
    status,
    summary: Object.freeze({
      heldEtfCount: etfRows.length,
      matchedEtfCount: etfRows.filter(
        (row) => row.mappingStatus === "matched",
      ).length,
      missingReferenceCount,
      ambiguousReferenceCount,
      evidenceAvailableEtfCount: etfRows.filter((row) => row.asOfDate !== null)
        .length,
      completeEvidenceEtfCount: etfRows.filter(
        (row) => row.evidenceStatus === "complete",
      ).length,
      etfPortfolioWeightPct,
      observedPortfolioExposurePct,
      uncoveredPortfolioExposurePct,
      componentCount: componentRows.length,
      overlapCount: componentRows.filter(
        (row) => row.hasDirectOverlap || row.hasMultiEtfOverlap,
      ).length,
      directOverlapCount: componentRows.filter((row) => row.hasDirectOverlap)
        .length,
      multiEtfOverlapCount: componentRows.filter(
        (row) => row.hasMultiEtfOverlap,
      ).length,
      asOfDates,
      mixedAsOfDates,
    }),
    etfRows: Object.freeze(etfRows),
    componentRows: Object.freeze(componentRows),
  });
}

type MutableComponent = {
  name: string;
  symbol: string;
  market: string;
  currency: string;
  portfolioExposurePct: number;
  sourceCandidateKeys: Set<string>;
  sourceInstrumentKeys: Set<string>;
  throughEtfs: Set<string>;
  asOfDates: Set<string>;
};

function buildEtfRow(
  candidate: ResolvedEtfCandidate,
  evidenceByMaster: Map<string, EtfHoldingRawRow[]>,
  components: Map<string, MutableComponent>,
): InvestmentLabEtfXrayEtfRow {
  const base = {
    name: candidate.name,
    ticker: candidate.ticker,
    accounts: Object.freeze([...candidate.accounts].sort()),
    market: candidate.market,
    currency: candidate.currency,
    currentValueKrw: candidate.currentValueKrw,
    portfolioWeightPct: candidate.portfolioWeightPct,
  } as const;

  if (candidate.masterMatches.length !== 1) {
    return Object.freeze({
      ...base,
      mappingStatus:
        candidate.masterMatches.length === 0
          ? ("missing_reference" as const)
          : ("ambiguous_reference" as const),
      evidenceStatus: "missing" as const,
      asOfDate: null,
      rawRowCount: 0,
      componentCount: 0,
      duplicateGroupCount: 0,
      unmappedComponentCount: 0,
      missingWeightCount: 0,
      observedWeightPct: null,
      uncoveredWeightPct: 100,
    });
  }

  const master = candidate.masterMatches[0];
  const allRows = evidenceByMaster.get(master.referenceId) ?? [];
  const asOfDate = selectLatestDate(allRows);
  if (!asOfDate) {
    return Object.freeze({
      ...base,
      mappingStatus: "matched" as const,
      evidenceStatus: "missing" as const,
      asOfDate: null,
      rawRowCount: 0,
      componentCount: 0,
      duplicateGroupCount: 0,
      unmappedComponentCount: 0,
      missingWeightCount: 0,
      observedWeightPct: null,
      uncoveredWeightPct: 100,
    });
  }

  const latestRows = allRows.filter((row) => row.asOfDate === asOfDate);
  const grouped = groupEtfHoldingRows(latestRows);
  const validComponents: Array<{
    key: string;
    name: string;
    symbol: string;
    market: string;
    currency: string;
    weightPct: number;
  }> = [];
  let numericWeightTotal = 0;
  let unmappedComponentCount = 0;
  let missingWeightCount = 0;

  for (const group of grouped.groups) {
    const symbol = canonicalUpper(group.holdingSymbol);
    const market =
      group.holdingMarket.status === "single"
        ? canonicalLower(group.holdingMarket.value)
        : null;
    const currency =
      group.currency.status === "single"
        ? canonicalUpper(group.currency.value)
        : null;
    const key = instrumentIdentityKey(market, currency, symbol);
    const rawWeightsComplete = group.rawRows.every((row) => {
      const value = toNumber(row.weightPct);
      return value !== null && value >= 0;
    });
    const weight = group.weightPct.value;
    const weightReady =
      group.weightPct.status === "sum" &&
      weight !== null &&
      Number.isFinite(weight) &&
      weight >= 0 &&
      rawWeightsComplete;

    if (!key || !symbol || !market || !currency) {
      unmappedComponentCount += 1;
    }
    if (!weightReady) {
      missingWeightCount += 1;
    } else {
      numericWeightTotal += weight;
    }
    if (!key || !symbol || !market || !currency || !weightReady) continue;

    validComponents.push({
      key,
      name: cleanText(group.holdingName) ?? symbol,
      symbol,
      market,
      currency,
      weightPct: weight,
    });
  }

  if (numericWeightTotal > 100 + COVERAGE_EPSILON) {
    return Object.freeze({
      ...base,
      mappingStatus: "matched" as const,
      evidenceStatus: "invalid_weight_total" as const,
      asOfDate,
      rawRowCount: grouped.rawRowCount,
      componentCount: grouped.groupedRowCount,
      duplicateGroupCount: grouped.duplicateGroupCount,
      unmappedComponentCount,
      missingWeightCount,
      observedWeightPct: null,
      uncoveredWeightPct: 100,
    });
  }

  const observedWeightPct = sum(
    validComponents.map((component) => component.weightPct),
  );
  const uncoveredWeightPct = Math.max(0, 100 - observedWeightPct);
  for (const component of validComponents) {
    addComponentExposure(components, {
      ...component,
      asOfDate,
      sourceCandidateKey: candidate.candidateKey,
      sourceInstrumentKey: candidate.instrumentKey,
      sourceEtf: candidate.ticker ?? candidate.name,
      portfolioExposurePct:
        (candidate.portfolioWeightPct * component.weightPct) / 100,
    });
  }
  const evidenceStatus =
    unmappedComponentCount === 0 &&
    missingWeightCount === 0 &&
    uncoveredWeightPct <= COVERAGE_EPSILON
      ? ("complete" as const)
      : ("partial" as const);

  return Object.freeze({
    ...base,
    mappingStatus: "matched" as const,
    evidenceStatus,
    asOfDate,
    rawRowCount: grouped.rawRowCount,
    componentCount: grouped.groupedRowCount,
    duplicateGroupCount: grouped.duplicateGroupCount,
    unmappedComponentCount,
    missingWeightCount,
    observedWeightPct,
    uncoveredWeightPct,
  });
}

function addComponentExposure(
  components: Map<string, MutableComponent>,
  input: {
    key: string;
    name: string;
    symbol: string;
    market: string;
    currency: string;
    portfolioExposurePct: number;
    sourceCandidateKey: string;
    sourceInstrumentKey: string | null;
    sourceEtf: string;
    asOfDate: string;
  },
) {
  const existing = components.get(input.key);
  if (existing) {
    existing.portfolioExposurePct += input.portfolioExposurePct;
    existing.sourceCandidateKeys.add(input.sourceCandidateKey);
    if (input.sourceInstrumentKey) {
      existing.sourceInstrumentKeys.add(input.sourceInstrumentKey);
    }
    existing.throughEtfs.add(input.sourceEtf);
    existing.asOfDates.add(input.asOfDate);
    return;
  }

  components.set(input.key, {
    name: input.name,
    symbol: input.symbol,
    market: input.market,
    currency: input.currency,
    portfolioExposurePct: input.portfolioExposurePct,
    sourceCandidateKeys: new Set([input.sourceCandidateKey]),
    sourceInstrumentKeys: new Set(
      input.sourceInstrumentKey ? [input.sourceInstrumentKey] : [],
    ),
    throughEtfs: new Set([input.sourceEtf]),
    asOfDates: new Set([input.asOfDate]),
  });
}

function finalizeComponentRow(
  key: string,
  component: MutableComponent,
  directWeights: Map<string, number>,
): InvestmentLabEtfXrayComponentRow {
  const directPortfolioWeightPct = component.sourceInstrumentKeys.has(key)
    ? 0
    : (directWeights.get(key) ?? 0);
  const throughEtfs = Object.freeze([...component.throughEtfs].sort());
  const asOfDates = Object.freeze([...component.asOfDates].sort());

  return Object.freeze({
    name: component.name,
    symbol: component.symbol,
    market: component.market,
    currency: component.currency,
    portfolioExposurePct: component.portfolioExposurePct,
    directPortfolioWeightPct,
    throughEtfCount: component.sourceCandidateKeys.size,
    throughEtfs,
    asOfDates,
    hasDirectOverlap: directPortfolioWeightPct > COVERAGE_EPSILON,
    hasMultiEtfOverlap: component.sourceCandidateKeys.size > 1,
  });
}

function groupEvidenceByMaster(rows: readonly EtfHoldingRawRow[]) {
  const result = new Map<string, EtfHoldingRawRow[]>();
  for (const row of rows) {
    if (!row.etfMasterId) continue;
    const existing = result.get(row.etfMasterId);
    if (existing) existing.push(row);
    else result.set(row.etfMasterId, [row]);
  }
  return result;
}

function selectLatestDate(rows: readonly EtfHoldingRawRow[]) {
  return rows
    .map((row) => row.asOfDate)
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function compareComponentRows(
  left: InvestmentLabEtfXrayComponentRow,
  right: InvestmentLabEtfXrayComponentRow,
) {
  return (
    right.portfolioExposurePct - left.portfolioExposurePct ||
    left.symbol.localeCompare(right.symbol)
  );
}

function canonicalUpper(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.toUpperCase() : null;
}

function canonicalLower(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.toLowerCase() : null;
}

function cleanText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}
