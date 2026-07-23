import { buildProviderHistoryShortlist } from "../src/lib/market-data/provider-history-shortlist.ts";

const REVIEWED_AT = "2026-07-23";
const REQUEST = Object.freeze({
  requestedSourceDateRange: Object.freeze({
    from: "2025-12-08",
    to: "2026-07-08",
  }),
  requiredInstruments: Object.freeze([
    Object.freeze({ market: "korea", currency: "KRW", ticker: "069500" }),
    Object.freeze({ market: "us", currency: "USD", ticker: "QQQ" }),
  ]),
});

const result = buildProviderHistoryShortlist({
  ...REQUEST,
  candidates: [eodhd(), twelveData(), kis()],
});

console.log(
  JSON.stringify(
    {
      audit: "provider_history_shortlist_v1",
      generatedAt: new Date().toISOString(),
      evidenceReviewedAt: REVIEWED_AT,
      readOnly: true,
      providerCalls: false,
      databaseReads: false,
      databaseWrites: false,
      request: REQUEST,
      result,
      interpretation: {
        recommendedProviderIds:
          result.summary.recommendedProviderIds,
        recommendationMeaning:
          "Closest candidate for the next evidence step, not an operational provider selection.",
        productBoundary:
          "No provider payload trial, shared cache, adapter, migration, backfill, runtime, UI, or TenantContext change is admitted.",
      },
    },
    null,
    2,
  ),
);

function eodhd() {
  const sources = [
    source(
      "eodhd-069500",
      "EODHD 069500.KO instrument summary",
      "https://eodhd.com/financial-summary/069500.KO",
    ),
    source(
      "eodhd-qqq",
      "EODHD QQQ.US instrument summary",
      "https://eodhd.com/financial-summary/QQQ.US",
    ),
    source(
      "eodhd-history",
      "EODHD historical EOD API",
      "https://eodhd.com/financial-apis/api-for-historical-data-and-volumes",
    ),
    source(
      "eodhd-license",
      "EODHD commercial versus personal license",
      "https://eodhd.com/financial-apis/commercial-vs-personal-license-use",
    ),
    source(
      "eodhd-terms",
      "EODHD terms and conditions",
      "https://eodhd.com/financial-apis/terms-conditions",
    ),
  ];
  return {
    providerId: "eodhd",
    officialSources: sources,
    entitlements: allEntitlements(
      "contract_required",
      ["eodhd-license", "eodhd-terms"],
    ),
    instrumentBindings: [
      binding({
        market: "korea",
        currency: "KRW",
        ticker: "069500",
        providerSymbol: "069500.KO",
        providerExchange: "XKRX",
        status: "documented",
        sourceIds: ["eodhd-069500"],
      }),
      binding({
        market: "us",
        currency: "USD",
        ticker: "QQQ",
        providerSymbol: "QQQ.US",
        providerExchange: "US",
        status: "documented",
        sourceIds: ["eodhd-qqq"],
      }),
    ],
    history: {
      endpointId: "/api/eod/{ticker}",
      rangeCapability: claim("documented", ["eodhd-history"]),
      pagination: claim("documented", ["eodhd-history"]),
      priceModel: claim("distribution_adjusted_documented", [
        "eodhd-history",
      ]),
      requestedWindowCoverage: "unproven",
      corporateActionParity: "unproven",
      correctionPolicy: claim("unproven"),
      duplicatePolicy: claim("unproven"),
    },
  };
}

function twelveData() {
  const sources = [
    source(
      "twelve-markets",
      "Twelve Data global stock market coverage",
      "https://twelvedata.com/stocks",
    ),
    source(
      "twelve-qqq",
      "Twelve Data QQQ historical data",
      "https://twelvedata.com/markets/958673/etf/nasdaq/qqq/historical-data",
    ),
    source(
      "twelve-docs",
      "Twelve Data API documentation",
      "https://twelvedata.com/docs/introduction/overview",
    ),
    source(
      "twelve-license",
      "Twelve Data commercial and personal usage",
      "https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage",
    ),
    source(
      "twelve-terms",
      "Twelve Data terms",
      "https://twelvedata.com/terms",
    ),
  ];
  return {
    providerId: "twelve_data",
    officialSources: sources,
    entitlements: allEntitlements(
      "contract_required",
      ["twelve-license", "twelve-terms"],
    ),
    instrumentBindings: [
      binding({
        market: "korea",
        currency: "KRW",
        ticker: "069500",
        providerSymbol: "069500",
        providerExchange: "XKRX",
        status: "unproven",
        sourceIds: ["twelve-markets"],
      }),
      binding({
        market: "us",
        currency: "USD",
        ticker: "QQQ",
        providerSymbol: "QQQ",
        providerExchange: "XNAS",
        status: "documented",
        sourceIds: ["twelve-qqq"],
      }),
    ],
    history: {
      endpointId: "/time_series?interval=1day&adjust=all",
      rangeCapability: claim("documented", [
        "twelve-markets",
        "twelve-docs",
      ]),
      pagination: claim("documented", ["twelve-docs"]),
      priceModel: claim(
        "split_and_distribution_components_documented",
        ["twelve-docs"],
      ),
      requestedWindowCoverage: "unproven",
      corporateActionParity: "unproven",
      correctionPolicy: claim("unproven"),
      duplicatePolicy: claim("unproven"),
    },
  };
}

function kis() {
  const sources = [
    source(
      "kis-partner",
      "KIS Developers partnership and market-data contract notice",
      "https://apiportal.koreainvestment.com/provider",
    ),
  ];
  return {
    providerId: "kis",
    officialSources: sources,
    entitlements: allEntitlements("contract_required", ["kis-partner"]),
    instrumentBindings: [
      binding({
        market: "korea",
        currency: "KRW",
        ticker: "069500",
        providerSymbol: "069500",
        providerExchange: "KRX",
        status: "runtime_observed",
      }),
      binding({
        market: "us",
        currency: "USD",
        ticker: "QQQ",
        providerSymbol: "QQQ",
        providerExchange: "NAS",
        status: "runtime_observed",
      }),
    ],
    history: {
      endpointId:
        "FHKST03010100.output2|HHDFS76240000.output2",
      rangeCapability: claim("unproven"),
      pagination: claim("unproven"),
      priceModel: claim("unproven"),
      requestedWindowCoverage: "unproven",
      corporateActionParity: "unproven",
      correctionPolicy: claim("unproven"),
      duplicatePolicy: claim("unproven"),
    },
  };
}

function source(id, title, url) {
  return { id, title, url, reviewedAt: REVIEWED_AT };
}

function allEntitlements(status, sourceIds) {
  return {
    fetch: claim(status, sourceIds),
    store: claim(status, sourceIds),
    display: claim(status, sourceIds),
    multiUser: claim(status, sourceIds),
  };
}

function binding(input) {
  return {
    instrument: {
      market: input.market,
      currency: input.currency,
      ticker: input.ticker,
    },
    providerSymbol: input.providerSymbol,
    providerExchange: input.providerExchange,
    evidence: claim(input.status, input.sourceIds),
  };
}

function claim(status, sourceIds = []) {
  return { status, sourceIds };
}
