import { Decimal } from "../money.ts";
import { easterSunday, shiftDate } from "../snapshots/market-calendar.ts";

export const ECB_VALUATION_SOURCE = "ecb_eur_cross";
export const ECB_VALUATION_POLICY = "ecb-eur-cross-2dp-prev-market-day-v1";
const ECB_SERIES =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+KRW.EUR.SP00.A";

/** ECB publishes on weekdays other than TARGET closing days, including KR/US-only holidays. */
export function ecbReferenceDate(serviceDate: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) ||
    shiftDate(serviceDate, 0) !== serviceDate
  )
    throw new Error("invalid_fx_service_date");
  let day = shiftDate(serviceDate, -1);
  for (;;) {
    const weekDay = new Date(day + "T00:00:00Z").getUTCDay();
    const easter = easterSunday(Number(day.slice(0, 4)));
    if (
      weekDay !== 0 &&
      weekDay !== 6 &&
      !["01-01", "05-01", "12-25", "12-26"].includes(day.slice(5)) &&
      day !== shiftDate(easter, -2) &&
      day !== shiftDate(easter, 1)
    )
      return day;
    day = shiftDate(day, -1);
  }
}

export function ecbCrossFromData(csv: string, referenceDate: string) {
  // detail=dataonly returns eight unquoted, machine-readable SDMX fields.
  const [header, ...records] = csv.trim().split(/\r?\n/);
  if (
    header !==
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE" ||
    records.length !== 2
  ) {
    throw new Error("ecb_missing_or_invalid_fixing");
  }
  const legs = new Map<string, string>();
  for (const record of records) {
    const fields = record.split(",");
    const ccy = fields[2],
      value = fields[7];
    if (
      fields.length !== 8 ||
      !["KRW", "USD"].includes(ccy) ||
      legs.has(ccy) ||
      fields.slice(0, 7).join(",") !==
        [
          `EXR.D.${ccy}.EUR.SP00.A`,
          "D",
          ccy,
          "EUR",
          "SP00",
          "A",
          referenceDate,
        ].join(",") ||
      !/^\d{1,12}(?:\.\d{1,8})?$/.test(value) ||
      Decimal.from(value).compare(0) <= 0
    )
      throw new Error("ecb_invalid_cross_leg");
    legs.set(ccy, value);
  }
  const krwPerEur = legs.get("KRW")!,
    usdPerEur = legs.get("USD")!;
  const hundredths = Decimal.from(krwPerEur)
    .div(usdPerEur)
    .mul(100)
    .minor("KRW", "nearest");
  return {
    referenceDate,
    krwPerEur,
    usdPerEur,
    rate: new Decimal(hundredths, BigInt(100)).toExactString(),
  };
}

export async function fetchEcbValuationFx(serviceDate: string) {
  const referenceDate = ecbReferenceDate(serviceDate);
  const url = new URL(ECB_SERIES);
  url.search = new URLSearchParams({
    startPeriod: referenceDate,
    endPeriod: referenceDate,
    format: "csvdata",
    detail: "dataonly",
  }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("ecb_reference_unavailable");
  const fixing = ecbCrossFromData(await response.text(), referenceDate);
  return { ...fixing, fetchedAt: new Date() };
}
