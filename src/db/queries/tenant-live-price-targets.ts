import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import {
  normalizeTenantLivePriceTarget,
  type TenantLivePriceTarget,
} from "@/lib/market-data/tenant-live-price-sync-policy";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getTenantLivePriceTargets(
  tenantContext: TenantContext,
): Promise<readonly TenantLivePriceTarget[]> {
  const resultSets = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [transaction.query(TENANT_LIVE_PRICE_TARGETS_SQL)],
  );

  return Object.freeze(
    resultSets[0].map((row) => {
      const target = normalizeTenantLivePriceTarget({
        ticker: stringValue(row.ticker),
        market: stringValue(row.market),
        currency: stringValue(row.currency),
      });

      if (!target) throw new Error("Tenant live price target is invalid");
      return target;
    }),
  );
}

const TENANT_LIVE_PRICE_TARGETS_SQL = `
  select distinct
    upper(trim(asset.ticker)) as ticker,
    lower(trim(asset.market)) as market,
    lower(trim(asset.currency)) as currency
  from public.assets as asset
  inner join public.accounts as account on asset.account_id = account.id
  where account.is_active = true
    and account.account_type <> 'cash'
    and asset.account = account.code
    and asset.canonical_owner_user_id = account.canonical_owner_user_id
    and asset.archived_at is null
    and nullif(trim(asset.ticker), '') is not null
    and trim(asset.ticker) <> '-'
    and coalesce(nullif(lower(trim(asset.asset_type)), ''), 'etf') in (
      'etf', 'stock', 'pension', 'commodity'
    )
  order by market, ticker, currency
`;

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
