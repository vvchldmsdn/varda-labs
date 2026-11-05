/** Form transitions only. No amounts, FX rates or financial records are inferred. */
type Fields = Record<string, string>;
export function executionDraftMode(fields: Fields) {
  return fields.inputMode === "execution_total" || fields.executionInputMode === "execution_total" ? "execution_total" : "execution";
}

export function editLedgerDraft(fields: Fields, kind: string, name: string, value: string, assetCurrency: string): Fields {
  if (kind === "exchange" && name === "currency" && value !== fields.currency) {
    return { ...fields, currency: value, amount: fields.credit ?? "", credit: fields.amount ?? "", fee: "", exchangeDirectionChanged: "yes" };
  }
  if (kind !== "buy" && kind !== "sell") return { ...fields, [name]: value };
  const beforeCash = fields.inputMode === "net" || fields.inputMode === "total";
  let next = { ...fields, [name]: value };
  if (name === "inputMode") {
    const executionMode = value === "execution" || value === "execution_total" ? value : executionDraftMode(fields);
    next = { ...next, executionInputMode: executionMode, settlementMode: value === "net" || value === "total" ? value : "none" };
  } else if (name === "settlementMode" && value === "none") {
    next.inputMode = executionDraftMode(fields);
    next.executionInputMode = next.inputMode;
  }
  const afterCash = next.inputMode === "net" || next.inputMode === "total";
  const beforeCurrency = beforeCash ? fields.settlementCurrency || assetCurrency : assetCurrency;
  const afterCurrency = afterCash ? next.settlementCurrency || assetCurrency : assetCurrency;
  if (beforeCurrency !== afterCurrency) {
    next = { ...next, fee: "", tax: "", costsReset: "yes" };
  }
  return next;
}

/** A fresh record type inherits context, never another type's amounts or confirmations. */
export function freshLedgerKindDraft(fields: Fields, kind: string): Fields {
  const result: Fields = { currency: fields.currency ?? "USD", at: fields.at ?? "", assetType: fields.assetType ?? "etf", inputMode: "execution" };
  if (["buy", "sell", "split", "cost_basis", "dividend", "fee"].includes(kind) && fields.assetId !== "new") result.assetId = fields.assetId ?? "";
  if (kind === "buy" && fields.assetId === "new") for (const key of ["assetId", "name", "ticker"]) if (fields[key] !== undefined) result[key] = fields[key];
  if (kind === "buy" || kind === "sell") for (const key of ["timePrecision", "tradeDate"]) if (fields[key] !== undefined) result[key] = fields[key];
  return result;
}

/** A reviewed photo starts a new execution, never reuses another draft's cash,
 * correction target, fees or confirmations. The caller retains the old draft
 * until the user explicitly applies the photo. */
export function applyTradePhotoFields(previous: Fields, assetId: string, photo: Fields): Fields {
  return {
    at: previous.at ?? "", assetType: previous.assetType ?? "etf",
    ...photo, assetId, settlementMode: "none",
    ...(previous.historyMode ? { historyMode: "yes" } : {}),
  };
}
