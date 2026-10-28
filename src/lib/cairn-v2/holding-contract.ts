import type { TenantHoldingDto } from '../tenant-holding-read-model';
import type { TenantHoldingQueryResult } from '../../db/queries/tenant-holdings';
import { betaHref, betaReadHref, type BetaContext } from './navigation';

// A key only identifies a row inside this read response. It is neither a public
// asset identifier nor a stable identity for joins, storage or authorization.
export type HoldingsRow = Omit<TenantHoldingDto, 'holdingId'> & { key: string };
export type HoldingsRead = {
  context: BetaContext;
  state: 'ready' | 'partial' | 'empty' | 'loading' | 'unauthorized' | 'unavailable';
  message: string;
  rows: HoldingsRow[];
  excludedHoldingCount: number;
  scopes: { key: string; label: string; detail: string }[];
  // Service-cycle date only resolves time-dependent group membership. It is
  // not the price observation date; each row keeps its own priceAsOf.
  serviceDate: string | null;
  queryKey?: string;
  readReceipt?: string;
  readEpoch?: string;
  readAt?: string;
};

export function blankHoldings(context: BetaContext, state: HoldingsRead['state'], message: string): HoldingsRead {
  return { context, state, message, rows: [], excludedHoldingCount: 0, scopes: [], serviceDate: null };
}

export function holdingsKey(context: BetaContext) {
  return JSON.stringify([context.mode, context.scope, context.currency]);
}

export function holdingsHref(context: BetaContext, epoch?: string | null) {
  const url = new URL(betaHref('/beta/portfolio/structure', context), 'https://beta.invalid');
  url.pathname = '/beta/portfolio/holdings';
  url.hash = 'stored-holdings';
  return betaReadHref(url.pathname + url.search + url.hash, epoch);
}

export function adaptHoldings(base: HoldingsRead, result: TenantHoldingQueryResult): HoldingsRead {
  if (result.state === 'unavailable') {
    return { ...base, state: 'unavailable', rows: [], excludedHoldingCount: 0, message: '저장 보유 자료 읽기 실패 · 예시나 현재 평가로 대체하지 않습니다' };
  }
  if (result.state === 'integrity_error') {
    return { ...base, state: 'unavailable', rows: [], excludedHoldingCount: 0, message: '보유 관계 검증 실패 · 저장 보유 자료를 표시하지 않습니다' };
  }
  // Do not spread the source DTO: private holding IDs or future query fields
  // must never silently cross this public boundary. Decimal strings stay exact.
  const rows: HoldingsRow[] = result.holdings.map((row, index) => ({
    key: `row-${index + 1}`,
    accountCode: row.accountCode,
    accountName: row.accountName,
    name: row.name,
    ticker: row.ticker,
    assetType: row.assetType,
    market: row.market,
    currency: row.currency,
    quantity: row.quantity,
    averageCost: row.averageCost,
    currentPrice: row.currentPrice,
    priceSource: row.priceSource,
    priceAsOf: row.priceAsOf,
    priceStatus: row.priceStatus,
    archivedAt: row.archivedAt,
    updatedAt: row.updatedAt,
  }));
  return {
    ...base,
    rows,
    excludedHoldingCount: result.excludedHoldingCount,
    state: result.state === 'partial' ? 'partial' : rows.length ? 'ready' : 'empty',
    message: result.state === 'partial'
      ? '일부 저장 보유 자료 제외 · 확인된 행만 표시합니다'
      : rows.length ? '소유 범위의 저장 보유 자료 · 수량·원가·저장 가격을 원본 단위로 표시합니다' : '현재 소유 범위에서 읽힌 저장 보유 자료가 없습니다',
  };
}
