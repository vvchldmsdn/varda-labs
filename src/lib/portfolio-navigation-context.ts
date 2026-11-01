/** Keep reporting context separate from the currency of a transaction's amounts. */
export function accountContextHref(path: string, accountId: string | undefined, reportingCurrency?: string) {
  const url = new URL(path, "https://cairn.invalid");
  if (accountId && /^[0-9a-f-]{36}$/i.test(accountId)) url.searchParams.set("scope", `account:${accountId}`);
  if (reportingCurrency === "USD" || reportingCurrency === "KRW") url.searchParams.set("currency", reportingCurrency);
  return url.pathname + url.search + url.hash;
}
