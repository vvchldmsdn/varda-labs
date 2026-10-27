import { toNumber } from "../portfolio-math.ts";

type FxEvidence = Readonly<{
  usdKrw: string | number | null;
  isSample: boolean;
  status: string | null;
  rateDate: string;
  fetchedAt?: Date | string | null;
  createdAt?: Date | string | null;
}>;

export function selectUsableFxRows<T extends FxEvidence>(rows: readonly T[]) {
  return rows.filter((row) => !row.isSample && row.status?.trim().toLowerCase() === "ok" &&
    positiveFxRate(row.usdKrw) !== null)
    .sort((left, right) => right.rateDate.localeCompare(left.rateDate) ||
      timestamp(right.fetchedAt) - timestamp(left.fetchedAt) ||
      timestamp(right.createdAt) - timestamp(left.createdAt));
}

export function resolveCurrentUsdKrwRate(rows: readonly FxEvidence[], fallback: unknown) {
  return positiveFxRate(selectUsableFxRows(rows)[0]?.usdKrw) ?? positiveFxRate(fallback);
}

export function positiveFxRate(value: unknown) {
  const rate = toNumber(value);
  return rate !== null && rate > 0 ? rate : null;
}

function timestamp(value: Date | string | null | undefined) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}
