import { latestRiskObservationOnOrBefore } from "./portfolio-risk-calendar.ts";
import type {
  AggregatedRiskInstrument,
  PortfolioRiskInputPolicy,
  PortfolioRiskReturnRow,
  PortfolioRiskValueObservation,
  PortfolioRiskValueRow,
  RiskFxObservation,
  RiskPriceObservation,
} from "./portfolio-risk-input-types.ts";

export function buildRiskValueRow({
  serviceDate,
  instruments,
  seriesByInstrument,
  fxSeries,
  policy,
}: {
  serviceDate: string;
  instruments: readonly AggregatedRiskInstrument[];
  seriesByInstrument: ReadonlyMap<string, RiskPriceObservation[]>;
  fxSeries: readonly RiskFxObservation[];
  policy: PortfolioRiskInputPolicy;
}): PortfolioRiskValueRow {
  const observations: PortfolioRiskValueObservation[] = [];
  const missing: PortfolioRiskValueRow["missing"] = [];

  for (const instrument of instruments) {
    const price = latestRiskObservationOnOrBefore(
      seriesByInstrument.get(instrument.key) ?? [],
      serviceDate,
    );
    if (!price) {
      missing.push({ instrumentKey: instrument.key, reason: "missing_price" });
      continue;
    }
    if (price.carryDays > policy.maxPriceCarryDays) {
      missing.push({ instrumentKey: instrument.key, reason: "stale_price" });
      continue;
    }

    const fx =
      instrument.currency === "USD"
        ? latestRiskObservationOnOrBefore(fxSeries, serviceDate)
        : null;
    if (instrument.currency === "USD" && !fx) {
      missing.push({ instrumentKey: instrument.key, reason: "missing_fx" });
      continue;
    }
    if (
      instrument.currency === "USD" &&
      fx &&
      fx.carryDays > policy.maxFxCarryDays
    ) {
      missing.push({ instrumentKey: instrument.key, reason: "stale_fx" });
      continue;
    }

    const fxRate = fx?.row.rate ?? 1;
    const unitValueKrw = price.row.localClose * fxRate;
    observations.push({
      instrumentKey: instrument.key,
      sourcePriceDate: price.row.sourceDate,
      priceCarryDays: price.carryDays,
      localClose: price.row.localClose,
      sourceFxDate: fx?.row.sourceDate ?? null,
      fxCarryDays: fx?.carryDays ?? 0,
      fxRate,
      unitValueKrw,
      holdingValueKrw: unitValueKrw * instrument.quantity,
    });
  }

  return {
    serviceDate,
    complete: missing.length === 0 && observations.length === instruments.length,
    observations,
    missing,
  };
}

export function buildRiskReturnRows(
  valueRows: readonly PortfolioRiskValueRow[],
) {
  const rows: PortfolioRiskReturnRow[] = [];

  for (let index = 1; index < valueRows.length; index += 1) {
    const previous = valueRows[index - 1];
    const current = valueRows[index];
    if (!previous.complete || !current.complete) continue;

    const previousByInstrument = new Map(
      previous.observations.map((row) => [row.instrumentKey, row]),
    );
    rows.push({
      previousServiceDate: previous.serviceDate,
      serviceDate: current.serviceDate,
      returns: current.observations.map((row) => {
        const previousObservation = previousByInstrument.get(row.instrumentKey);
        if (!previousObservation) {
          throw new Error(`Missing previous risk observation for ${row.instrumentKey}`);
        }
        return {
          instrumentKey: row.instrumentKey,
          value: row.unitValueKrw / previousObservation.unitValueKrw - 1,
        };
      }),
    });
  }

  return rows;
}

export function attachRiskEndWeights<
  T extends {
    instrumentKey: string;
    endValueKrw: number | null;
    weight: number | null;
  },
>(instruments: readonly T[], valueRow: PortfolioRiskValueRow | null) {
  if (!valueRow) return [...instruments];

  const values = new Map(
    valueRow.observations.map((row) => [row.instrumentKey, row.holdingValueKrw]),
  );
  const total = instruments.reduce(
    (sum, instrument) => sum + (values.get(instrument.instrumentKey) ?? 0),
    0,
  );
  return instruments.map((instrument) => {
    const endValueKrw = values.get(instrument.instrumentKey) ?? null;
    return {
      ...instrument,
      endValueKrw,
      weight: endValueKrw !== null && total > 0 ? endValueKrw / total : null,
    };
  });
}
