/** Current FX does not establish historical USD acquisition cost in KRW. */
export function admittedContributionCostBasisKrw(row: { currency: string | null; costBasisKrw?: number | null }) {
  return row.currency === "KRW" ? row.costBasisKrw ?? null : null;
}
