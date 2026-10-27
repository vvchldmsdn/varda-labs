import { QUICK_INSTRUMENTS } from "./quick-portfolio.ts";
import type { CurrencyResearchInput, CurrencyResearchHistory } from "./currency-research.ts";
import type { FxEvidence } from "./currency-valuation.ts";

/** Development/test fixture only. The calling route must guard access; never fallback to this for missing personal data. */
export function currencyResearchFixture(): CurrencyResearchInput {
  const dates: string[] = [];
  for (let day = new Date("2026-05-01T00:00:00Z"); day <= new Date("2026-09-11T00:00:00Z"); day = new Date(day.getTime() + 86_400_000)) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(day.toISOString());
  }
  const fx: FxEvidence[] = dates.map((at, index) => ({ base: "USD", quote: "KRW", rate: (1350 + index * .8 + Math.sin(index / 9) * 24).toFixed(4), observedAt: at, fetchedAt: at, source: "synthetic_currency_research_fixture", kind: "synthetic" }));
  const selections = [QUICK_INSTRUMENTS[0], QUICK_INSTRUMENTS[2], QUICK_INSTRUMENTS[5]];
  const histories: CurrencyResearchHistory[] = selections.map((instrument, assetIndex) => {
    let price = assetIndex === 0 ? 32000 : assetIndex === 1 ? 400 : 90;
    return { instrumentId: instrument.id, source: "synthetic_currency_research_fixture", admission: "synthetic_fixture", corporateActions: { status: "synthetic_none", source: "synthetic_fixture_no_corporate_events", from: dates[0], through: dates.at(-1)! }, points: dates.map((at, index) => {
      if (index > 0) price *= 1 + .0004 + Math.sin(index * 1.71 + assetIndex * 1.3) * .012 + Math.cos(index / 5 + assetIndex) * .004;
      return { at, price: price.toFixed(8), currency: instrument.currency, basis: "raw_price", dataset: `synthetic-${instrument.id}-v1` };
    }) };
  });
  const asOf = dates.at(-1)!;
  return { input: { version: 2, currency: "KRW", asOf, timeZone: "Asia/Seoul", locale: "ko", source: "manual", rows: selections.map((instrument, index) => ({ name: instrument.name, value: [5000000, 3000000, 2000000][index], instrumentId: instrument.id, inputCurrency: "KRW" })) },
    reportingCurrency: "KRW", asOf, histories, fx, provenance: "synthetic_fixture", horizon: 126 };
}
