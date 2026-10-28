import { SAVE_EFFECT_SQL, LINK_EFFECT_SQL } from '@/db/contribution-effect-sql';
import 'server-only';
import { getTenantSqlClient } from '@/db/tenant-client';
import { readNativeContributionContext } from '@/db/queries/native-contribution-context';
import { readNativeLedger } from '@/db/queries/native-portfolio-ledger';
import { getTrackedCurrencyEvidence } from '@/db/queries/currency-tracked-portfolio';
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from '@/db/queries/portfolio-analysis-scopes';
import { compareContribution, prepareContributionComparison } from '@/lib/contribution-comparison';
import { eligibleEffectTrade, evaluateContributionEffect, type EffectQuote, type EffectTrade, type SavedContributionEffect, type ContributionEffectDocument } from '@/lib/contribution-effect';
import type { TenantContext } from '@/lib/session-resolver-contract';
import { Decimal, type Currency } from '@/lib/money';

export async function listContributionEffects(tenant: TenantContext, accountId: string): Promise<SavedContributionEffect[]> {
  const [, rows] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query('select id,created_at as "createdAt",revision,document,trade_ids as "tradeIds" from contribution_effects where owner_user_id=$1::uuid and account_id=$2::uuid order by created_at desc,id limit 100', [tenant.ownerUserId, accountId]),
  ], { readOnly: true });
  return rows.map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })) as SavedContributionEffect[];
}

export async function saveContributionEffect(tenant: TenantContext, request: { id: string; accountId: string; amount: string; currency: Currency; evidenceVersion: string }) {
  const old = (await listContributionEffects(tenant, request.accountId)).find(row => row.id === request.id);
  if (old) {
    const previous = old.document.comparison;
    const budget = Decimal.from(request.amount).mul(request.currency === 'USD' ? previous.basis.usdKrw ?? 0 : 1).toNumber();
    return previous.funding === request.currency && previous.budget === budget && previous.basis.evidenceVersion === request.evidenceVersion ? { status: 'existing' as const, id: old.id } : { status: 'blocked' as const, reason: 'save_conflict_or_limit' };
  }
  const context = await readNativeContributionContext(tenant, `account:${request.accountId}`, 'KRW', true);
  if (context.status !== 'ready') return context;
  if (context.evidenceVersion !== request.evidenceVersion) return { status: 'blocked' as const, reason: 'basis_changed' };
  const basis = prepareContributionComparison(context);
  if (basis.status !== 'ready') return basis;
  const comparison = compareContribution(basis, request.amount, request.currency);
  if (comparison.status !== 'ready') return comparison;
  const quotes = context.input.rows.flatMap(row => {
    const quote = (row.metadata as { entryQuote?: Omit<EffectQuote, 'key'> } | null)?.entryQuote;
    return quote?.basis === 'raw' && quote.source ? [{ ...quote, key: row.allocationKey }] : [];
  });
  if (comparison.basis.rows.some(row => (comparison.ratio.amounts[row.allocationKey] || comparison.adjusted.amounts[row.allocationKey] || comparison.aligned.amounts[row.allocationKey]) && !quotes.some(q => q.key === row.allocationKey))) return { status: 'blocked' as const, reason: 'entry_quote_missing' };
  const document: ContributionEffectDocument = { version: 'contribution_effect_v1', accountId: request.accountId, capturedAt: new Date().toISOString(), comparison, quotes };
  const [, , rows] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`varda.portfolio_mutation.v1:${tenant.ownerUserId}`]),
    tx.query(SAVE_EFFECT_SQL, [tenant.ownerUserId, request.id, request.accountId, JSON.stringify(document), JSON.stringify(context.nativeSequences), JSON.stringify(context.policy), JSON.stringify(context.holdingGuard)]),
  ]);
  return rows.length ? { status: 'created' as const, id: request.id } : { status: 'blocked' as const, reason: 'save_conflict_or_limit' };
}

function ledgerTrades(ledger: Awaited<ReturnType<typeof readNativeLedger>>): EffectTrade[] {
  return ledger.entries.flatMap(row => {
    const event = row.data.event;
    if (event.type !== 'buy' && event.type !== 'sell' && event.type !== 'split') return [];
    return [{ id: row.id, accountId: row.accountId, assetId: event.assetId, type: event.type as EffectTrade['type'], at: event.at,
      ...('quantity' in event ? { quantity: event.quantity, price: event.price, currency: event.currency, dateOnly: !!event.dateEvidence } : {}) }];
  });
}

export async function readContributionEffects(tenant: TenantContext, accountId: string) {
  const scoped = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext: tenant, scope: `account:${accountId}` });
  if (scoped.state !== 'ready' || scoped.resolution.state !== 'resolved' || scoped.resolution.scope.kind !== 'account' || scoped.resolution.scope.accountId !== accountId) return [];
  const [saved, ledger, evidence] = await Promise.all([listContributionEffects(tenant, accountId), readNativeLedger(tenant, accountId), getTrackedCurrencyEvidence(tenant, scoped.resolution.scope, 'KRW')]);
  const trades = ledgerTrades(ledger);
  return saved.map(row => {
    const quotes = row.document.quotes.flatMap(entry => {
      const owned = ledger.accounts.some(account => account.id === accountId && account.assets.some(asset => asset.id === entry.assetId));
      const position = owned ? evidence.current.positions.find(p => p.id === entry.assetId && p.kind !== 'cash') : null;
      const observation = position && !position.evidenceReason && !position.unsupportedReason ? position.observation : null;
      return observation?.basis === 'raw' ? [{ key: entry.key, assetId: entry.assetId, price: observation.price, currency: observation.currency, at: observation.priceObservedAt ?? observation.at, source: observation.source, basis: 'raw' as const }] : [];
    });
    return { ...row, result: evaluateContributionEffect(row, { asOf: evidence.asOf, quotes, fx: evidence.fx, complete: ledger.accountsComplete && ledger.entriesComplete, maxFxAgeMs: evidence.maxFxAgeMs ?? 3 * 86400000 }, trades),
      candidates: ledger.entriesComplete ? trades.filter(t => eligibleEffectTrade(row.document, t) && Date.parse(t.at) <= Date.parse(evidence.asOf)).map(t => ({ ...t, name: row.document.comparison.basis.rows.find(r => row.document.quotes.find(q => q.assetId === t.assetId)?.key === r.allocationKey)?.metadata.name ?? t.assetId })) : [] };
  });
}
export type ContributionEffectView = Awaited<ReturnType<typeof readContributionEffects>>[number];

export async function linkContributionEffect(tenant: TenantContext, request: { id: string; accountId: string; revision: number; tradeIds: string[] }) {
  const [saved, ledger] = await Promise.all([listContributionEffects(tenant, request.accountId), readNativeLedger(tenant, request.accountId)]);
  const plan = saved.find(p => p.id === request.id), trades = ledgerTrades(ledger);
  if (!plan || !ledger.entriesComplete || request.tradeIds.some(id => !trades.some(t => t.id === id && eligibleEffectTrade(plan.document, t) && Date.parse(t.at) <= Date.now()))) return { status: 'blocked' as const, reason: 'trade_unavailable' };
  const [, , rows] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`varda.portfolio_mutation.v1:${tenant.ownerUserId}`]),
    tx.query(LINK_EFFECT_SQL, [tenant.ownerUserId, request.id, request.accountId, JSON.stringify(request.tradeIds), request.revision]),
  ]);
  return { status: rows.length ? 'linked' as const : 'blocked' as const, reason: rows.length ? undefined : 'link_conflict' };
}
