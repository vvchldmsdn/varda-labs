/** These KIS live endpoints supply a collection receipt, not exchange observation
 * time. Applies to existing stored rows as well as newly collected quotes. */
export function isCollectionPriceSource(source: string | null | undefined) {
  return !!source && /^kis(?:$|_domestic_inquire_price$|_overseas_price:)/.test(source);
}
