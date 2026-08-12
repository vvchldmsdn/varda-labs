export const ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY = Object.freeze({
  version: "additional_contribution_ma120_bounded_overlay_candidate_v1",
  authority: "comparison_only",
  priceDistanceBufferPct: 3,
  minimumMultiplier: 0.5,
  maxEvidenceAgeCalendarDays: 7,
  insufficientOrInvalidEvidence: "neutral_multiplier",
  reducedBudgetTreatment: "residual_cash",
  redistribution: "forbidden",
  targetRewrite: "forbidden",
  sellAction: "forbidden",
  recommendation: "forbidden",
  runtimeBinding: "not_enabled",
} as const);

const MA_STATUS_DISTANCE_TOLERANCE_PCT = 1e-9;

export type AdditionalContributionMa120OverlayMode = "off" | "candidate";

export type AdditionalContributionMa120OverlayEvidenceStatus =
  | "above_ma"
  | "at_ma"
  | "below_ma"
  | "insufficient_history"
  | "invalid_history"
  | "unavailable";

export type AdditionalContributionMa120OverlayDecision =
  | "overlay_off"
  | "above_or_at_ma"
  | "below_ma_buffer"
  | "below_ma_floor"
  | "missing_evidence"
  | "unusable_evidence"
  | "stale_evidence"
  | "future_evidence";

export type AdditionalContributionMa120OverlayBlocker =
  | "invalid_mode"
  | "invalid_service_date"
  | "invalid_cash_amount"
  | "invalid_baseline_totals"
  | "invalid_baseline_allocation"
  | "invalid_instrument_identity"
  | "duplicate_baseline_instrument"
  | "duplicate_evidence_instrument";

export type AdditionalContributionMa120OverlayBaseline = Readonly<{
  cashAmountKrw: number;
  totalAllocatedKrw: number;
  residualCashKrw: number;
  allocations: readonly Readonly<{
    market: string | null;
    currency: string | null;
    ticker: string | null;
    allocationKrw: number;
  }>[];
}>;

export type AdditionalContributionMa120OverlayEvidenceInput = Readonly<{
  instrumentKey: string;
  status: AdditionalContributionMa120OverlayEvidenceStatus;
  latestWindowPriceDate: string | null;
  distanceFromMaPct: number | null;
}>;

type NormalizedBaselineRow = Readonly<{
  instrumentKey: string;
  market: string;
  currency: string;
  ticker: string;
  allocationKrw: number;
}>;

export function compareAdditionalContributionMa120Overlay(input: {
  mode: AdditionalContributionMa120OverlayMode;
  serviceDate: string;
  baseline: AdditionalContributionMa120OverlayBaseline;
  evidence: readonly AdditionalContributionMa120OverlayEvidenceInput[];
}) {
  const blockers = new Set<AdditionalContributionMa120OverlayBlocker>();
  const serviceDate = normalizeDate(input.serviceDate);
  const mode = input.mode === "off" || input.mode === "candidate"
    ? input.mode
    : null;
  if (!mode) blockers.add("invalid_mode");
  if (!serviceDate) blockers.add("invalid_service_date");

  const baselineRows = normalizeBaseline(input.baseline, blockers);
  const evidenceByInstrument = normalizeEvidence(input.evidence, blockers);
  if (blockers.size > 0 || !mode || !serviceDate) {
    return blocked(input.baseline, blockers);
  }

  const rows = baselineRows.map((row) => {
    const overlay = mode === "off"
      ? neutralOverlay("overlay_off")
      : evaluateEvidence({
          evidence: evidenceByInstrument.get(row.instrumentKey) ?? null,
          serviceDate,
        });
    const overlayAllocationKrw = Math.ceil(
      row.allocationKrw * overlay.multiplier,
    );
    return Object.freeze({
      ...row,
      strategicAllocationKrw: row.allocationKrw,
      multiplier: overlay.multiplier,
      overlayAllocationKrw,
      reductionKrw: row.allocationKrw - overlayAllocationKrw,
      evidenceStatus: overlay.evidenceStatus,
      evidenceAgeCalendarDays: overlay.evidenceAgeCalendarDays,
      decision: overlay.decision,
    });
  });
  const overlayAllocatedKrw = rows.reduce(
    (sum, row) => sum + row.overlayAllocationKrw,
    0,
  );
  const totalReductionKrw =
    input.baseline.totalAllocatedKrw - overlayAllocatedKrw;
  const overlayResidualCashKrw =
    input.baseline.residualCashKrw + totalReductionKrw;
  const neutralEvidenceCount = rows.filter(
    (row) =>
      row.decision === "missing_evidence" ||
      row.decision === "unusable_evidence" ||
      row.decision === "stale_evidence" ||
      row.decision === "future_evidence",
  ).length;

  if (
    overlayAllocatedKrw + overlayResidualCashKrw !==
      input.baseline.cashAmountKrw ||
    rows.some(
      (row) =>
        !Number.isSafeInteger(row.overlayAllocationKrw) ||
        row.overlayAllocationKrw < 0 ||
        row.overlayAllocationKrw > row.strategicAllocationKrw,
    )
  ) {
    blockers.add("invalid_baseline_totals");
    return blocked(input.baseline, blockers);
  }

  return Object.freeze({
    status:
      mode === "off"
        ? ("disabled" as const)
        : neutralEvidenceCount > 0
          ? ("partial" as const)
          : ("ready" as const),
    policy: ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY,
    mode,
    serviceDate,
    baseline: input.baseline,
    strategicAllocatedKrw: input.baseline.totalAllocatedKrw,
    strategicResidualCashKrw: input.baseline.residualCashKrw,
    overlayAllocatedKrw,
    overlayResidualCashKrw,
    totalReductionKrw,
    neutralEvidenceCount,
    rows: Object.freeze(rows),
    blockers: Object.freeze([] as AdditionalContributionMa120OverlayBlocker[]),
  });
}

function normalizeBaseline(
  baseline: AdditionalContributionMa120OverlayBaseline,
  blockers: Set<AdditionalContributionMa120OverlayBlocker>,
) {
  if (!Number.isSafeInteger(baseline?.cashAmountKrw) || baseline.cashAmountKrw <= 0) {
    blockers.add("invalid_cash_amount");
  }
  if (
    !Number.isSafeInteger(baseline?.totalAllocatedKrw) ||
    baseline.totalAllocatedKrw < 0 ||
    !Number.isSafeInteger(baseline?.residualCashKrw) ||
    baseline.residualCashKrw < 0 ||
    baseline.totalAllocatedKrw + baseline.residualCashKrw !==
      baseline.cashAmountKrw
  ) {
    blockers.add("invalid_baseline_totals");
  }

  const normalizedRows: NormalizedBaselineRow[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(baseline?.allocations)
    ? baseline.allocations
    : []) {
    const identity = normalizeIdentity(row);
    if (!identity) {
      blockers.add("invalid_instrument_identity");
      continue;
    }
    if (!Number.isSafeInteger(row.allocationKrw) || row.allocationKrw < 0) {
      blockers.add("invalid_baseline_allocation");
      continue;
    }
    if (seen.has(identity.instrumentKey)) {
      blockers.add("duplicate_baseline_instrument");
      continue;
    }
    seen.add(identity.instrumentKey);
    normalizedRows.push(Object.freeze({ ...identity, allocationKrw: row.allocationKrw }));
  }
  const allocated = normalizedRows.reduce(
    (sum, row) => sum + row.allocationKrw,
    0,
  );
  if (allocated !== baseline?.totalAllocatedKrw) {
    blockers.add("invalid_baseline_totals");
  }
  return normalizedRows.sort((left, right) =>
    left.instrumentKey.localeCompare(right.instrumentKey),
  );
}

function normalizeEvidence(
  evidence: readonly AdditionalContributionMa120OverlayEvidenceInput[],
  blockers: Set<AdditionalContributionMa120OverlayBlocker>,
) {
  const rows = new Map<string, AdditionalContributionMa120OverlayEvidenceInput>();
  for (const row of Array.isArray(evidence) ? evidence : []) {
    const instrumentKey = normalizeInstrumentKey(row?.instrumentKey);
    if (!instrumentKey) {
      blockers.add("invalid_instrument_identity");
      continue;
    }
    if (rows.has(instrumentKey)) {
      blockers.add("duplicate_evidence_instrument");
      continue;
    }
    rows.set(instrumentKey, Object.freeze({ ...row, instrumentKey }));
  }
  return rows;
}

function evaluateEvidence({
  evidence,
  serviceDate,
}: {
  evidence: AdditionalContributionMa120OverlayEvidenceInput | null;
  serviceDate: string;
}) {
  if (!evidence) return neutralOverlay("missing_evidence");
  if (
    evidence.status === "insufficient_history" ||
    evidence.status === "invalid_history" ||
    evidence.status === "unavailable"
  ) {
    return neutralOverlay("unusable_evidence", evidence.status);
  }

  const latestDate = normalizeDate(evidence.latestWindowPriceDate);
  const distance = evidence.distanceFromMaPct;
  if (!latestDate || typeof distance !== "number" || !Number.isFinite(distance)) {
    return neutralOverlay("unusable_evidence", evidence.status);
  }
  const age = utcDayDifference(serviceDate, latestDate);
  if (age < 0) {
    return neutralOverlay("future_evidence", evidence.status, age);
  }
  if (age > ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY.maxEvidenceAgeCalendarDays) {
    return neutralOverlay("stale_evidence", evidence.status, age);
  }
  if (
    (evidence.status === "above_ma" && distance <= 0) ||
    (evidence.status === "at_ma" &&
      Math.abs(distance) > MA_STATUS_DISTANCE_TOLERANCE_PCT) ||
    (evidence.status === "below_ma" && distance >= 0)
  ) {
    return neutralOverlay("unusable_evidence", evidence.status, age);
  }
  if (evidence.status !== "below_ma") {
    return neutralOverlay("above_or_at_ma", evidence.status, age);
  }

  const buffer =
    ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY.priceDistanceBufferPct;
  const floor = ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY.minimumMultiplier;
  const depth = Math.min(1, Math.abs(distance) / buffer);
  const multiplier = 1 - depth * (1 - floor);
  return Object.freeze({
    multiplier,
    evidenceStatus: evidence.status,
    evidenceAgeCalendarDays: age,
    decision: depth >= 1 ? ("below_ma_floor" as const) : ("below_ma_buffer" as const),
  });
}

function neutralOverlay(
  decision: AdditionalContributionMa120OverlayDecision,
  evidenceStatus: AdditionalContributionMa120OverlayEvidenceStatus | null = null,
  evidenceAgeCalendarDays: number | null = null,
) {
  return Object.freeze({
    multiplier: 1,
    evidenceStatus,
    evidenceAgeCalendarDays,
    decision,
  });
}

function blocked(
  baseline: AdditionalContributionMa120OverlayBaseline,
  blockers: ReadonlySet<AdditionalContributionMa120OverlayBlocker>,
) {
  return Object.freeze({
    status: "blocked" as const,
    policy: ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY,
    mode: null,
    serviceDate: null,
    baseline,
    strategicAllocatedKrw: null,
    strategicResidualCashKrw: null,
    overlayAllocatedKrw: null,
    overlayResidualCashKrw: null,
    totalReductionKrw: null,
    neutralEvidenceCount: null,
    rows: Object.freeze([]),
    blockers: Object.freeze([...blockers].sort()),
  });
}

function normalizeIdentity(row: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}) {
  const market = normalizeText(row?.market)?.toLowerCase();
  const currency = normalizeText(row?.currency)?.toUpperCase();
  const ticker = normalizeText(row?.ticker)?.toUpperCase();
  if (!market || !currency || !ticker) return null;
  const instrumentKey = normalizeInstrumentKey(`${market}:${currency}:${ticker}`);
  return instrumentKey
    ? Object.freeze({ instrumentKey, market, currency, ticker })
    : null;
}

function normalizeInstrumentKey(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^[a-z0-9._-]+:[A-Z0-9._-]+:[A-Z0-9._-]+$/.test(normalized)
    ? normalized
    : null;
}

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeDate(value: unknown) {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? date
    : null;
}

function utcDayDifference(later: string, earlier: string) {
  return (
    (Date.parse(`${later}T00:00:00.000Z`) -
      Date.parse(`${earlier}T00:00:00.000Z`)) /
    86_400_000
  );
}
