export const HOLDING_ONBOARDING_POLICY = Object.freeze({
  version: "holding_onboarding_v1",
  averageCostAuthority: "user_entered_per_unit_in_instrument_currency",
  reportedReturnRole: "reference_only",
  duplicateIdentity:
    "canonical_owner_user_id_account_id_market_currency_ticker",
} as const);

export const HOLDING_ONBOARDING_MARKETS = Object.freeze([
  Object.freeze({ value: "korea", label: "한국", currency: "KRW" }),
  Object.freeze({ value: "us", label: "미국", currency: "USD" }),
] as const);

export const HOLDING_ONBOARDING_ASSET_TYPES = Object.freeze([
  Object.freeze({ value: "etf", label: "ETF" }),
  Object.freeze({ value: "stock", label: "주식" }),
] as const);

export type HoldingOnboardingMarket =
  (typeof HOLDING_ONBOARDING_MARKETS)[number]["value"];
export type HoldingOnboardingAssetType =
  (typeof HOLDING_ONBOARDING_ASSET_TYPES)[number]["value"];

export type HoldingOnboardingInput = Readonly<{
  accountId: string;
  portfolioGroupId: string | null;
  newPortfolioGroupName: string | null;
  market: HoldingOnboardingMarket;
  currency: "KRW" | "USD";
  assetType: HoldingOnboardingAssetType;
  ticker: string;
  name: string | null;
  quantity: string;
  averageCost: string;
  currentPrice: string | null;
  reportedReturnPct: string | null;
}>;

export type HoldingOnboardingActionState = Readonly<{
  status:
    | "idle"
    | "success"
    | "invalid"
    | "unauthorized"
    | "conflict"
    | "error";
  message: string | null;
  assetId?: string;
}>;

export type HoldingOnboardingParseResult =
  | Readonly<{ ok: true; input: HoldingOnboardingInput }>
  | Readonly<{
      ok: false;
      field:
        | "accountId"
        | "portfolioGroup"
        | "market"
        | "assetType"
        | "ticker"
        | "name"
        | "quantity"
        | "averageCost"
        | "currentPrice"
        | "reportedReturnPct";
      message: string;
    }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,49}$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const SIGNED_DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

export function parseHoldingOnboardingInput(
  formData: FormData,
): HoldingOnboardingParseResult {
  const accountId = textValue(formData.get("accountId"));
  if (!accountId || !UUID_PATTERN.test(accountId)) {
    return invalid("accountId", "보유 계좌를 선택해 주세요.");
  }

  const portfolioGroupId = textValue(formData.get("portfolioGroupId"));
  const newPortfolioGroupName = textValue(
    formData.get("newPortfolioGroupName"),
  );
  if (portfolioGroupId && !UUID_PATTERN.test(portfolioGroupId)) {
    return invalid("portfolioGroup", "자산 그룹 선택이 올바르지 않습니다.");
  }
  if (portfolioGroupId && newPortfolioGroupName) {
    return invalid(
      "portfolioGroup",
      "기존 자산 그룹 선택과 새 그룹 이름 중 하나만 입력해 주세요.",
    );
  }
  if (!portfolioGroupId && !newPortfolioGroupName) {
    return invalid(
      "portfolioGroup",
      "기존 자산 그룹을 선택하거나 새 그룹 이름을 입력해 주세요.",
    );
  }
  if (newPortfolioGroupName && newPortfolioGroupName.length > 100) {
    return invalid(
      "portfolioGroup",
      "새 자산 그룹 이름은 100자 이하여야 합니다.",
    );
  }

  const market = textValue(formData.get("market"))?.toLowerCase();
  const marketPolicy = HOLDING_ONBOARDING_MARKETS.find(
    (candidate) => candidate.value === market,
  );
  if (!marketPolicy) {
    return invalid("market", "상장 시장을 선택해 주세요.");
  }

  const assetType = textValue(formData.get("assetType"))?.toLowerCase();
  if (!HOLDING_ONBOARDING_ASSET_TYPES.some(({ value }) => value === assetType)) {
    return invalid("assetType", "종목 유형을 선택해 주세요.");
  }

  const ticker = textValue(formData.get("ticker"))?.toUpperCase();
  if (!ticker || !TICKER_PATTERN.test(ticker)) {
    return invalid(
      "ticker",
      "티커는 영문, 숫자, 점, 밑줄 또는 하이픈으로 입력해 주세요.",
    );
  }

  const name = textValue(formData.get("name"));
  if (name && name.length > 255) {
    return invalid("name", "종목명은 255자 이하여야 합니다.");
  }

  const quantity = positiveDecimal(formData.get("quantity"), 6);
  if (quantity === null) {
    return invalid(
      "quantity",
      "보유 수량은 0보다 큰 숫자로 소수점 6자리까지 입력해 주세요.",
    );
  }

  const averageCost = positiveDecimal(formData.get("averageCost"), 4);
  if (averageCost === null) {
    return invalid(
      "averageCost",
      "1좌당 매입 원가는 0보다 큰 숫자로 소수점 4자리까지 입력해 주세요.",
    );
  }

  const rawCurrentPrice = textValue(formData.get("currentPrice"));
  const currentPrice =
    rawCurrentPrice === null ? null : positiveDecimal(rawCurrentPrice, 4);
  if (rawCurrentPrice !== null && currentPrice === null) {
    return invalid(
      "currentPrice",
      "현재가는 0보다 큰 숫자로 소수점 4자리까지 입력해 주세요.",
    );
  }

  const rawReportedReturn = textValue(formData.get("reportedReturnPct"));
  const reportedReturnPct =
    rawReportedReturn === null
      ? null
      : signedDecimal(rawReportedReturn, 6, -100);
  if (rawReportedReturn !== null && reportedReturnPct === null) {
    return invalid(
      "reportedReturnPct",
      "현재 수익률은 -100%보다 큰 숫자로 소수점 6자리까지 입력해 주세요.",
    );
  }

  return Object.freeze({
    ok: true,
    input: Object.freeze({
      accountId,
      portfolioGroupId,
      newPortfolioGroupName,
      market: marketPolicy.value,
      currency: marketPolicy.currency,
      assetType: assetType as HoldingOnboardingAssetType,
      ticker,
      name,
      quantity,
      averageCost,
      currentPrice,
      reportedReturnPct,
    }),
  });
}

export function calculateLocalReturnPct(input: {
  averageCost: string | number;
  currentPrice: string | number;
}) {
  const averageCost = Number(input.averageCost);
  const currentPrice = Number(input.currentPrice);
  if (
    !Number.isFinite(averageCost) ||
    !Number.isFinite(currentPrice) ||
    averageCost <= 0 ||
    currentPrice <= 0
  ) {
    return null;
  }
  return ((currentPrice - averageCost) / averageCost) * 100;
}

function positiveDecimal(value: FormDataEntryValue | string | null, scale: number) {
  const normalized = textValue(value);
  if (!normalized || !DECIMAL_PATTERN.test(normalized)) return null;
  if ((normalized.split(".")[1]?.length ?? 0) > scale) return null;
  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) && numericValue > 0
    ? normalized
    : null;
}

function signedDecimal(
  value: FormDataEntryValue | string | null,
  scale: number,
  exclusiveMinimum: number,
) {
  const normalized = textValue(value);
  if (!normalized || !SIGNED_DECIMAL_PATTERN.test(normalized)) return null;
  if ((normalized.split(".")[1]?.length ?? 0) > scale) return null;
  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) && numericValue > exclusiveMinimum
    ? normalized
    : null;
}

function textValue(value: FormDataEntryValue | string | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function invalid(
  field: Extract<HoldingOnboardingParseResult, { ok: false }>["field"],
  message: string,
): HoldingOnboardingParseResult {
  return Object.freeze({ ok: false, field, message });
}
