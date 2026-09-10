import { T } from "@/components/i18n/localized-text";
import { HoldingAnalysisDataForm } from "@/components/holding-analysis-data-form";
import { HoldingArchiveForm, HoldingRestoreForm } from "@/components/holding-lifecycle-forms";
import { HoldingStateCorrectionForm } from "@/components/holding-state-correction-form";
import { ManualKrxGoldPriceForm } from "@/components/manual-krx-gold-price-form";
import { isKrxGoldManualAssetCandidate } from "@/lib/market-data/manual-asset-price";
import type { HoldingAnalysisDataReadiness } from "@/lib/holding-analysis-data-readiness";
import type { TenantHoldingDto } from "@/lib/tenant-holding-read-model";

export function HoldingsManagementList({ holdings, analysisDataByHolding }: {
  holdings: readonly TenantHoldingDto[];
  analysisDataByHolding: ReadonlyMap<string, HoldingAnalysisDataReadiness>;
}) {
  const active = holdings.filter(holding => holding.archivedAt === null);
  const archived = holdings.filter(holding => holding.archivedAt !== null);
  return <div data-holdings-management-list>
    <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
      {!active.length ? <p className="py-8 text-sm text-[var(--muted)]"><T ko="이 범위에 현재 보유 중인 종목이 없습니다." en="There are no current holdings in this scope." /></p> : active.map(holding => <article key={holding.holdingId} className="min-w-0 py-6" data-holding-management={holding.holdingId}>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(230px,.7fr)] lg:gap-10">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-medium">{holding.name}</h2>
            <p className="mt-1 break-words text-xs leading-5 text-[var(--muted)]">{holding.accountName} · {holding.ticker ?? <T ko="티커 없음" en="No ticker" />} · <MarketLabel market={holding.market} /> / {holding.currency}</p>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-xs text-[var(--muted)]"><T ko="보유 수량" en="Quantity" /></dt><dd className="mt-1 break-words font-medium tabular-nums">{formatStoredNumber(holding.quantity)}</dd></div>
              <div><dt className="text-xs text-[var(--muted)]"><T ko="평균 매입가" en="Average cost" /></dt><dd className="mt-1 break-words font-medium tabular-nums">{holding.averageCost === null ? <T ko="미등록" en="Not recorded" /> : `${formatStoredNumber(holding.averageCost)} ${holding.currency}`}</dd>{holding.averageCost === null ? <dd className="mt-1 text-xs text-[var(--muted)]"><T ko="나중에 입력할 수 있어요." en="You can add it later." /></dd> : null}</div>
            </dl>
          </div>
          <div className="min-w-0 border-t border-[var(--line)] pt-4 lg:border-0 lg:pt-1">
            <HoldingStateCorrectionForm averageCost={holding.averageCost} currency={holding.currency} holdingId={holding.holdingId} quantity={holding.quantity} updatedAt={holding.updatedAt} />
            <HoldingArchiveForm holdingId={holding.holdingId} updatedAt={holding.updatedAt} />
          </div>
        </div>
        <div className="mt-5 grid min-w-0 gap-3 lg:grid-cols-2 lg:gap-10">
          <details className="min-w-0 text-xs leading-5">
            <summary className="w-fit cursor-pointer py-2 font-medium text-[var(--muted)]"><T ko="저장된 가격·종목 정보" en="Stored price & holding details" /></summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
              <dt className="text-[var(--muted)]"><T ko="저장된 가격" en="Stored price" /></dt><dd className="break-words text-right tabular-nums">{formatStoredNumber(holding.currentPrice)} {holding.currency}</dd>
              <dt className="text-[var(--muted)]"><T ko="가격 상태" en="Price status" /></dt><dd className="break-words text-right"><PriceStatus status={holding.priceStatus} /></dd>
              <dt className="text-[var(--muted)]"><T ko="가격 출처" en="Price source" /></dt><dd className="break-all text-right">{holding.priceSource ?? <T ko="미확인" en="Unavailable" />}</dd>
              <dt className="text-[var(--muted)]"><T ko="가격 확인 시각" en="Price recorded at" /></dt><dd className="break-words text-right">{formatStoredTimestamp(holding.priceAsOf)}</dd>
              <dt className="text-[var(--muted)]"><T ko="자산 종류" en="Asset type" /></dt><dd className="break-words text-right"><AssetTypeLabel type={holding.assetType} /></dd>
            </dl>
            <p className="mt-3 text-[var(--muted)]"><T ko="보유종목 기록에 저장된 가격입니다. 최신 시세를 반영한 평가액은 홈에서 확인하세요." en="This price was saved with the holding. Home shows valuation using the latest available quotes." /></p>
            {isKrxGoldManualAssetCandidate(holding) ? <div className="mt-3"><ManualKrxGoldPriceForm key={holding.currentPrice} currentPrice={holding.currentPrice} /></div> : null}
          </details>
          <details className="min-w-0 text-xs leading-5">
            <summary className="w-fit cursor-pointer py-2 font-medium text-[var(--muted)]"><T ko="분석 데이터 준비 상태" en="Analysis data readiness" /></summary>
            <div className="mt-2"><HoldingAnalysisDataForm holdingId={holding.holdingId} readiness={analysisDataByHolding.get(holding.holdingId) ?? null} /></div>
          </details>
        </div>
      </article>)}
    </div>
    {archived.length ? <section className="mt-8">
      <h2 className="text-lg font-medium"><T ko="종료된 보유종목" en="Closed holdings" /> <span className="text-[var(--muted)]">{archived.length}</span></h2>
      <p className="mt-2 text-sm text-[var(--muted)]"><T ko="현재 평가에서 제외되며 수량·매입원가·과거 기록은 보존됩니다." en="Excluded from current valuation; quantity, cost and historical records are preserved." /></p>
      <div className="mt-4 divide-y divide-[var(--line)]">{archived.map(holding => <article key={holding.holdingId} className="grid min-w-0 gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_230px]">
        <div className="min-w-0"><h3 className="break-words font-medium">{holding.name}</h3><p className="mt-1 break-words text-xs text-[var(--muted)]">{holding.accountName} · {holding.ticker ?? "—"}</p><p className="mt-2 text-xs"><T ko="보유 수량" en="Quantity" /> {formatStoredNumber(holding.quantity)}</p><p className="mt-1 text-xs text-[var(--muted)]"><T ko="종료 시각" en="Closed at" /> {formatStoredTimestamp(holding.archivedAt)}</p></div>
        <HoldingRestoreForm holdingId={holding.holdingId} updatedAt={holding.updatedAt} />
      </article>)}</div>
    </section> : null}
  </div>;
}

function MarketLabel({ market }: { market: string }) {
  return market === "korea" ? <T ko="한국" en="Korea" /> : market === "us" ? <T ko="미국" en="US" /> : market;
}
function PriceStatus({ status }: { status: string | null }) {
  if (status === "ok") return <T ko="확인됨" en="Recorded" />;
  if (status === "manual") return <T ko="직접 입력" en="Manual" />;
  if (status === "error") return <T ko="확인 필요" en="Needs review" />;
  return status ?? <T ko="미확인" en="Unavailable" />;
}
function AssetTypeLabel({ type }: { type: string | null }) {
  const labels: Record<string, { ko: string; en: string }> = { stock: { ko: "주식", en: "Stock" }, etf: { ko: "ETF", en: "ETF" }, gold: { ko: "금", en: "Gold" }, bond: { ko: "채권", en: "Bond" }, cash: { ko: "현금", en: "Cash" } };
  return type && labels[type] ? <T {...labels[type]} /> : type ?? "—";
}
function formatStoredNumber(value: string) {
  const [whole, decimals = ""] = value.split(".");
  const fraction = decimals.replace(/0+$/, "");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}
function formatStoredTimestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value))} ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }).format(new Date(value))} KST`;
}
