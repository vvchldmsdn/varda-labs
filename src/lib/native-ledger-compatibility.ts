export const NATIVE_LEDGER_REQUIRED_MESSAGE = "이 계좌는 거래 원장으로 수량·현금·매입원가를 관리합니다. 매수·매도 또는 매입원가 보완으로 이어가 주세요.";
export const NATIVE_ACCOUNT_BALANCE_MESSAGE = "계좌에 현금이나 보유 수량이 남아 있습니다. 거래 원장에서 잔액과 실제 거래를 확인한 뒤 계좌를 종료해 주세요.";

export function nativeLedgerHref(accountId?: string, assetId?: string, action?: "buy" | "sell" | "cost_basis") {
  const query = new URLSearchParams();
  if (accountId) query.set("accountId", accountId);
  if (assetId) query.set("assetId", assetId);
  if (action) query.set("action", action);
  return `/portfolio/ledger${query.size ? `?${query}` : ""}`;
}

export function isNativeLedgerGuardError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && ["N0001", "N0002"].includes(String(error.code));
}
