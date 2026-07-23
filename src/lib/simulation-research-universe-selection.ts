import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";
import {
  SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY,
  type SimulationResearchUniverseInstrument,
  type SimulationResearchUniverseSelection,
  type SimulationResearchUniverseSelectionIssue,
} from "./simulation-research-universe-preflight-policy.ts";

export function resolveSimulationResearchUniverseSelection(
  suppliedValue: string | string[] | undefined,
): SimulationResearchUniverseSelection {
  if (suppliedValue === undefined) {
    return Object.freeze({
      status: "not_requested" as const,
      rawValue: null,
      issues: Object.freeze([]),
      instruments: Object.freeze([]),
      totalWeightBps: 0 as const,
    });
  }

  if (Array.isArray(suppliedValue)) {
    return invalidSelection(null, ["repeated_query"], [], 0);
  }

  const rawValue = suppliedValue.trim();
  if (rawValue.length === 0) {
    return invalidSelection(rawValue, ["empty_query"], [], 0);
  }
  if (
    rawValue.length >
    SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY.maximumQueryLength
  ) {
    return invalidSelection(rawValue, ["query_too_long"], [], 0);
  }

  const rawRows = rawValue.split(",");
  if (
    rawRows.length >
    SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY.maximumRowCount
  ) {
    return invalidSelection(rawValue, ["too_many_rows"], [], 0);
  }

  const issues = new Set<SimulationResearchUniverseSelectionIssue>();
  const instruments: SimulationResearchUniverseInstrument[] = [];
  const identities = new Set<string>();

  for (const rawRow of rawRows) {
    const fields = rawRow.split(":").map((value) => value.trim());
    if (fields.length !== 4) {
      issues.add("invalid_row_format");
      continue;
    }

    const [rawMarket, rawCurrency, rawTicker, rawWeightBps] = fields;
    const market = rawMarket.toLowerCase();
    const currency = rawCurrency.toUpperCase();
    const ticker = rawTicker.toUpperCase();

    if (!/^[a-z][a-z0-9_-]{0,19}$/.test(market)) {
      issues.add("invalid_market");
      continue;
    }
    if (currency !== "KRW" && currency !== "USD") {
      issues.add("invalid_currency");
      continue;
    }
    if (!/^[A-Z0-9][A-Z0-9._^-]{0,49}$/.test(ticker)) {
      issues.add("invalid_ticker");
      continue;
    }
    if (!/^(?:0|[1-9]\d{0,4})$/.test(rawWeightBps)) {
      issues.add("invalid_weight_bps");
      continue;
    }

    const weightBps = Number(rawWeightBps);
    if (
      !Number.isSafeInteger(weightBps) ||
      weightBps >
        SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY.requiredWeightBps
    ) {
      issues.add("invalid_weight_bps");
      continue;
    }

    const instrumentKey = `${market}|${currency}|${ticker}`;
    if (identities.has(instrumentKey)) {
      issues.add("duplicate_instrument");
      continue;
    }
    identities.add(instrumentKey);
    instruments.push(
      Object.freeze({
        instrumentKey,
        market,
        currency,
        ticker,
        weightBps,
        classification: classifyResearchInstrument({ market, ticker }),
      }),
    );
  }

  const totalWeightBps = instruments.reduce(
    (total, row) => total + row.weightBps,
    0,
  );
  if (
    totalWeightBps !==
    SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY.requiredWeightBps
  ) {
    issues.add("weight_total_not_10000");
  }
  if (issues.size > 0) {
    return invalidSelection(
      rawValue,
      [...issues].sort(),
      instruments,
      totalWeightBps,
    );
  }

  return Object.freeze({
    status: "valid" as const,
    rawValue,
    issues: Object.freeze([]),
    instruments: Object.freeze(instruments),
    totalWeightBps: 10_000 as const,
  });
}

function invalidSelection(
  rawValue: string | null,
  issues: readonly SimulationResearchUniverseSelectionIssue[],
  instruments: readonly SimulationResearchUniverseInstrument[],
  totalWeightBps: number,
): SimulationResearchUniverseSelection {
  return Object.freeze({
    status: "invalid" as const,
    rawValue,
    issues: Object.freeze([...issues]),
    instruments: Object.freeze([...instruments]),
    totalWeightBps,
  });
}

function classifyResearchInstrument(input: {
  market: string;
  ticker: string;
}): PortfolioHoldingClassification {
  if (input.ticker === "FOUNT" || input.market === "managed") {
    return "managed_sleeve";
  }
  if (
    input.ticker === "GOLD_9999_1KG" ||
    input.market === "krx-gold"
  ) {
    return "physical_commodity_position";
  }
  return "listed_instrument";
}
