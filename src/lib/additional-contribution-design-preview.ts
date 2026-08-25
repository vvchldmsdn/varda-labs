import type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { allocateTargetDeficits } from "@/lib/target-deficit-allocation";

const BROKERAGE_ID = "11111111-1111-4111-8111-111111111111";
const ISA_ID = "22222222-2222-4222-8222-222222222222";
const IRP_ID = "33333333-3333-4333-8333-333333333333";
const GROWTH_ID = "44444444-4444-4444-8444-444444444444";
const INCOME_ID = "55555555-5555-4555-8555-555555555555";

const SCOPES = Object.freeze([
  { kind: "all", key: "all", label: "전체 자산" },
  {
    kind: "portfolio_group",
    key: `portfolio:${GROWTH_ID}`,
    label: "성장 자산",
    portfolioGroupId: GROWTH_ID,
  },
  {
    kind: "portfolio_group",
    key: `portfolio:${INCOME_ID}`,
    label: "인컴 자산",
    portfolioGroupId: INCOME_ID,
  },
  {
    kind: "account",
    key: `account:${BROKERAGE_ID}`,
    label: "증권",
    accountId: BROKERAGE_ID,
    accountCode: "brokerage",
  },
  {
    kind: "account",
    key: `account:${ISA_ID}`,
    label: "ISA",
    accountId: ISA_ID,
    accountCode: "isa",
  },
  {
    kind: "account",
    key: `account:${IRP_ID}`,
    label: "IRP",
    accountId: IRP_ID,
    accountCode: "irp",
  },
] satisfies readonly PortfolioAnalysisScope[]);

const HOLDINGS = Object.freeze([
  holding("KODEX 200", "069500", "brokerage", "증권", "growth", 5_612_300, 1_700),
  holding("Vanguard S&P 500 ETF", "VOO", "brokerage", "증권", "growth", 4_706_500, 1_500, "us", "USD"),
  holding("ACE 고배당", "0139P0", "brokerage", "증권", "income", 4_103_200, 1_000),
  holding("Schwab US Dividend Equity ETF", "SCHD", "brokerage", "증권", "income", 3_091_800, 1_000, "us", "USD"),
  holding("Invesco QQQ Trust", "QQQ", "brokerage", "증권", "growth", 2_281_400, 800, "us", "USD", true),
  holding("KODEX AI반도체TOP10+", "395160", "brokerage", "증권", "growth", 1_847_200, 800),
  holding("RISE AI전력인프라", "0101N0", "isa", "ISA", "growth", 2_092_700, 800, "korea", "KRW", true),
  holding("TIGER 미국나스닥100", "133690", "isa", "ISA", "growth", 1_883_500, 700),
  holding("KODEX 미국배당다우존스", "489250", "isa", "ISA", "income", 1_412_800, 700),
  holding("KODEX 일본TOPIX100", "101280", "irp", "IRP", "growth", 1_716_900, 600),
  holding("SOL 한국원자력SMR", "0092B0", "irp", "IRP", "growth", 1_550_800, 400),
]);

export function buildAdditionalContributionDesignPreview({
  amountKrw,
  scopeInput,
}: {
  amountKrw: number;
  scopeInput: string | readonly string[] | undefined;
}) {
  const requestedScope = Array.isArray(scopeInput) ? scopeInput[0] : scopeInput;
  const selectedScope =
    SCOPES.find((scope) => scope.key === requestedScope) ?? SCOPES[0];
  const selectedHoldings = HOLDINGS.filter((row) =>
    belongsToScope(row, selectedScope),
  );
  const targetWeights = normalizeTargetWeights(selectedHoldings);
  const allocation = allocateTargetDeficits({
    cashAmountKrw: amountKrw,
    rows: selectedHoldings.map((row) => ({
      allocationKey: `${row.accountCode}:${row.ticker}`,
      buyable: true,
      currentValueKrw: row.currentValueKrw,
      targetWeightBps: targetWeights.get(row.ticker) ?? 0,
      metadata: row,
    })),
  });
  if (allocation.status !== "ready") {
    throw new Error(`Additional contribution design fixture is invalid: ${allocation.blockers.join(",")}`);
  }

  const rows = allocation.rows.map((row) => {
    const reductionKrw = row.metadata.belowMa120
      ? Math.round(row.allocationKrw * 0.35)
      : 0;
    const allocationKrw = row.allocationKrw - reductionKrw;
    return Object.freeze({
      accountCode: row.metadata.accountCode,
      accountName: row.metadata.accountName,
      allocationKrw,
      currentValueKrw: row.currentValueKrw,
      currentWeightPct:
        (row.currentValueKrw / allocation.currentPortfolioTotalKrw) * 100,
      currency: row.metadata.currency,
      ma120ReductionKrw: reductionKrw,
      market: row.metadata.market,
      name: row.metadata.name,
      postTopupValueKrw: row.currentValueKrw + allocationKrw,
      postTopupWeightPct:
        ((row.currentValueKrw + allocationKrw) /
          allocation.postTopupTotalKrw) *
        100,
      strategicAllocationKrw: row.allocationKrw,
      targetWeightPct: row.targetWeightBps / 100,
      ticker: row.metadata.ticker,
      ma120Evidence: Object.freeze({
        status: row.metadata.belowMa120 ? "below_ma" as const : "above_ma" as const,
        priceBasis: "private_kis_raw_close" as const,
        availableObservationCount: 120,
        latestWindowPriceDate: "2026-08-21",
        ma120: row.metadata.currency === "KRW" ? 94_600 : 512.48,
        distanceFromMaPct: row.metadata.belowMa120 ? -4.8 : 7.2,
      }),
    });
  });
  const totalAllocatedKrw = rows.reduce(
    (total, row) => total + row.allocationKrw,
    0,
  );
  const totalReductionKrw = rows.reduce(
    (total, row) => total + row.ma120ReductionKrw,
    0,
  );
  const preview = Object.freeze({
    status: "ready" as const,
    cashAmountKrw: amountKrw,
    currentPortfolioTotalKrw: allocation.currentPortfolioTotalKrw,
    postTopupTotalKrw: allocation.postTopupTotalKrw,
    totalAllocatedKrw,
    residualCashKrw: amountKrw - totalAllocatedKrw,
    effectiveServiceDate: "2026-07-11",
    policyLabel: "사용자 목표비중",
    serviceDate: "2026-08-21",
    ma120Evidence: Object.freeze({
      mode: "enabled" as const,
      status: totalReductionKrw > 0 ? "partial" as const : "ready" as const,
      usableCount: rows.length,
      totalReductionKrw,
    }),
    rows: Object.freeze(rows),
  }) satisfies AdditionalContributionResultPreview;

  return Object.freeze({
    preview,
    scopes: SCOPES,
    selectedScope,
  });
}

type Holding = ReturnType<typeof holding>;

function holding(
  name: string,
  ticker: string,
  accountCode: string,
  accountName: string,
  group: "growth" | "income",
  currentValueKrw: number,
  rawTargetBps: number,
  market = "korea",
  currency = "KRW",
  belowMa120 = false,
) {
  return Object.freeze({
    accountCode,
    accountName,
    belowMa120,
    currency,
    currentValueKrw,
    group,
    market,
    name,
    rawTargetBps,
    ticker,
  });
}

function belongsToScope(row: Holding, scope: PortfolioAnalysisScope) {
  if (scope.kind === "all") return true;
  if (scope.kind === "account") return row.accountCode === scope.accountCode;
  return scope.portfolioGroupId === GROWTH_ID
    ? row.group === "growth"
    : row.group === "income";
}

function normalizeTargetWeights(rows: readonly Holding[]) {
  const rawTotal = rows.reduce((total, row) => total + row.rawTargetBps, 0);
  const working = rows.map((row) => {
    const exact = (row.rawTargetBps / rawTotal) * 10_000;
    return {
      ticker: row.ticker,
      targetWeightBps: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining =
    10_000 - working.reduce((total, row) => total + row.targetWeightBps, 0);
  for (const row of working.toSorted(
    (left, right) =>
      right.remainder - left.remainder ||
      left.ticker.localeCompare(right.ticker),
  )) {
    if (remaining === 0) break;
    row.targetWeightBps += 1;
    remaining -= 1;
  }
  return new Map(working.map((row) => [row.ticker, row.targetWeightBps]));
}
