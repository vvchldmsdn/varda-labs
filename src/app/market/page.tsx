import { T } from "@/components/i18n/localized-text";
import { localizedMetadata } from "@/lib/i18n/server";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";
import type { ReactNode } from "react";

import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import {
  getReadOnlyTenantMarketContext,
  type ReadOnlyMarketBenchmark,
  type ReadOnlyMarketFactor,
  type ReadOnlyMarketFactorFamily,
  type ReadOnlyMarketRegime,
} from "@/db/queries/market-context";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import type { MarketRegimeDuplicateGroup } from "@/lib/market-context";
import { PageTitle as CairnPageTitle, SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";


export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "시장 데이터 | CAIRN LABS" }, "Market data | CAIRN LABS");
}

export default async function MarketPage() {
  const resolution = await resolveCurrentTenantContext();

  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        closedMessage="로그인한 사용자가 확인되기 전에는 시장 현황을 조회하지 않습니다."
        closedMessageEn="Market context remains closed until the signed-in product user is resolved."
        description="벤치마크와 글로벌 요인은 공통 참고 데이터입니다. 계좌별 시장 국면은 현재 사용자 소유의 계좌에서만 조회합니다."
        descriptionEn="Benchmarks and global factors are shared references. Account regime rows are selected only through accounts owned by the current user."
        resolution={resolution}
        title="시장 현황"
        titleEn="Market Context"
      />
    );
  }

  const marketContext = await getReadOnlyTenantMarketContext({
    tenantContext: resolution.tenantContext,
  });

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-4">
        <header className="border-b border-[var(--line)] py-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">
                Cairn Labs
              </p>
              <CairnPageTitle className="mt-1 text-2xl font-semibold tracking-normal">
                <T ko="시장 현황" en="Market Context" />
              </CairnPageTitle>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <Link
                href="/"
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[var(--muted)] hover:bg-[var(--wash)]"
              >
                <T ko="홈" en="Dashboard" />
              </Link>
              <Link
                href="/etfs"
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[var(--muted)] hover:bg-[var(--wash)]"
              >
                <T ko="ETF 구성" en="ETF Reference" />
              </Link>
            </nav>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SummaryCell
              label={<T ko="비교 지수" en="Benchmarks" />}
              value={`${marketContext.benchmarks.length}/${marketContext.requestedBenchmarkTickers.length}`}
              detail={marketContext.requestedBenchmarkTickers.join(", ")}
            />
            <SummaryCell
              label={<T ko="국면 확인 계좌" en="Regime accounts" />}
              value={String(marketContext.regimes.length)}
              detail={<T ko={`중복 일자·계좌 ${marketContext.regimeDuplicateGroupCount}건`} en={`${marketContext.regimeDuplicateGroupCount} duplicate date/account groups`} />}
            />
            <SummaryCell
              label={<T ko="글로벌 지표" en="Global factors" />}
              value={String(
                marketContext.factorFamilies.reduce(
                  (sum, family) => sum + family.factors.length,
                  0,
                ),
              )}
              detail={<T ko={`${marketContext.factorFamilies.length}개 분야`} en={`${marketContext.factorFamilies.length} families`} />}
            />
          </div>
        </header>

        <section className="border-b border-[var(--line)] py-6">
          <SectionHeader title={<T ko="비교 지수" en="Benchmarks" />} detail={<T ko="종목별 최신 저장값" en="latest row per ticker" />} />
          <BenchmarkTable benchmarks={marketContext.benchmarks} />
        </section>

        <section className="border-b border-[var(--line)] py-6">
          <SectionHeader
            title={<T ko="시장 국면" en="Market Regime" />}
            detail={<T ko="계좌별 최신 저장 분석" en="latest row per account with duplicate context" />}
          />
          <MarketRegimeTable regimes={marketContext.regimes} />
          <DuplicateGroups groups={marketContext.regimeDuplicateGroups} />
        </section>

        <section className="border-b border-[var(--line)] py-6">
          <SectionHeader
            title={<T ko="글로벌 지표" en="Global Factors" />}
            detail={<T ko="분야별 최신 저장값" en="latest row per factor key, grouped by family" />}
          />
          <GlobalFactorFamilies families={marketContext.factorFamilies} />
        </section>
      </div>
    </main>
  );
}

function SummaryCell({
  label,
  value,
  detail,
}: {
  label: ReactNode;
  value: string;
  detail: ReactNode;
}) {
  return (
    <div className="py-3">
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function SectionHeader({ title, detail }: { title: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <CairnSectionTitle className="text-lg font-semibold tracking-normal">{title}</CairnSectionTitle>
      <p className="text-xs font-semibold text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function BenchmarkTable({
  benchmarks,
}: {
  benchmarks: ReadOnlyMarketBenchmark[];
}) {
  if (benchmarks.length === 0) {
    return <EmptyTableMessage><T ko="비교 지수 자료가 없습니다." en="No benchmark rows found." /></EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-[760px] w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[var(--muted)]">
          <tr>
            <TableHeader><T ko="티커" en="Ticker" /></TableHeader>
            <TableHeader><T ko="이름" en="Name" /></TableHeader>
            <TableHeader><T ko="기준일" en="Date" /></TableHeader>
            <TableHeader><T ko="출처" en="Source" /></TableHeader>
            <TableHeader><T ko="통화" en="Currency" /></TableHeader>
            <TableHeader align="right"><T ko="종가" en="Close" /></TableHeader>
            <TableHeader align="right"><T ko="정규화 지수" en="Normalized" /></TableHeader>
            <TableHeader align="right"><T ko="환율" en="FX" /></TableHeader>
          </tr>
        </thead>
        <tbody>
          {benchmarks.map((benchmark) => (
            <tr key={benchmark.ticker} className="border-t border-[var(--wash)]">
              <TableCell strong>{benchmark.ticker}</TableCell>
              <TableCell>{benchmark.name}</TableCell>
              <TableCell>{benchmark.date}</TableCell>
              <TableCell>{benchmark.source ?? "—"}</TableCell>
              <TableCell>{benchmark.currency}</TableCell>
              <TableCell align="right">
                {formatDecimal(benchmark.closePrice, 2)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(benchmark.normalizedIndexValue, 2)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(benchmark.fxRate, 2)}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarketRegimeTable({ regimes }: { regimes: ReadOnlyMarketRegime[] }) {
  if (regimes.length === 0) {
    return <EmptyTableMessage><T ko="저장된 시장 국면이 없습니다." en="No market regime rows found." /></EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[var(--muted)]">
          <tr>
            <TableHeader><T ko="계좌" en="Account" /></TableHeader>
            <TableHeader><T ko="기준일" en="Date" /></TableHeader>
            <TableHeader><T ko="국면" en="Label" /></TableHeader>
            <TableHeader><T ko="영향 요인" en="Drivers" /></TableHeader>
            <TableHeader align="right"><T ko="국면 점수" en="Regime" /></TableHeader>
            <TableHeader align="right"><T ko="거시환경" en="Macro" /></TableHeader>
            <TableHeader align="right"><T ko="시장 심리" en="Sentiment" /></TableHeader>
            <TableHeader align="right"><T ko="상관계수" en="Correlation" /></TableHeader>
            <TableHeader align="right"><T ko="유효 종목 수" en="ENB" /></TableHeader>
            <TableHeader align="right"><T ko="변동성" en="Volatility" /></TableHeader>
            <TableHeader><T ko="중복 기록" en="Duplicate" /></TableHeader>
          </tr>
        </thead>
        <tbody>
          {regimes.map((regime) => (
            <tr key={regime.account} className="border-t border-[var(--wash)]">
              <TableCell strong>{regime.account}</TableCell>
              <TableCell>{regime.date}</TableCell>
              <TableCell>{regime.label}</TableCell>
              <TableCell>{regime.driverKeys.length ? <details><summary><T ko="영향 요인 보기" en="View drivers" /></summary>{regime.driverKeys.join(", ")}</details> : "—"}</TableCell>
              <TableCell align="right">
                {formatDecimal(regime.regimeScore, 3)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(regime.macroStressScore, 3)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(regime.newsSentimentScore, 3)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(regime.avgCorrelation, 3)}
              </TableCell>
              <TableCell align="right">{formatDecimal(regime.enb, 3)}</TableCell>
              <TableCell align="right">
                {formatDecimal(regime.portfolioVolatility, 3)}
              </TableCell>
              <TableCell>
                {regime.duplicateRowCount > 1
                  ? <T ko={`${regime.duplicateRowCount}건`} en={`${regime.duplicateRowCount} rows`} />
                  : "—"}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicateGroups({ groups }: { groups: MarketRegimeDuplicateGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <details className="mt-3 rounded-md border border-[var(--wash)] bg-white px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
        <T ko={`중복 기록 ${groups.length}건 확인`} en={`Review ${groups.length} duplicate groups`} />
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-[520px] w-full text-left text-xs">
          <thead className="uppercase text-[var(--muted)]">
            <tr>
              <TableHeader><T ko="기준일" en="Date" /></TableHeader>
              <TableHeader><T ko="계좌" en="Account" /></TableHeader>
              <TableHeader align="right"><T ko="기록 수" en="Rows" /></TableHeader>
              <TableHeader><T ko="선택한 이전 기록 ID" en="Selected legacy id" /></TableHeader>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr
                key={`${group.date}-${group.account}`}
                className="border-t border-[var(--wash)]"
              >
                <TableCell>{group.date}</TableCell>
                <TableCell>{group.account}</TableCell>
                <TableCell align="right">{group.rowCount}</TableCell>
                <TableCell>{group.selectedLegacyBase44Id ?? "—"}</TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function GlobalFactorFamilies({
  families,
}: {
  families: ReadOnlyMarketFactorFamily[];
}) {
  if (families.length === 0) {
    return <EmptyTableMessage><T ko="글로벌 지표 자료가 없습니다." en="No global market factor rows found." /></EmptyTableMessage>;
  }

  return (
    <div className="mt-3 space-y-4">
      {families.map((family) => (
        <div
          key={family.family}
          className="border-t border-[var(--line)] py-4"
        >
          <div className="flex items-center justify-between gap-3">
            <CairnSectionTitle level="h3" className="text-base font-semibold tracking-normal">
              {marketLabel(family.family)}
            </CairnSectionTitle>
            <p className="text-xs font-semibold text-[var(--muted)]">
              <T ko={`${family.factors.length}개 지표`} en={`${family.factors.length} factors`} />
            </p>
          </div>
          <GlobalFactorsTable factors={family.factors} />
        </div>
      ))}
    </div>
  );
}

function GlobalFactorsTable({ factors }: { factors: ReadOnlyMarketFactor[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-[1180px] w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[var(--muted)]">
          <tr>
            <TableHeader><T ko="지표" en="Factor" /></TableHeader>
            <TableHeader><T ko="이름" en="Name" /></TableHeader>
            <TableHeader><T ko="기준일" en="Date" /></TableHeader>
            <TableHeader><T ko="주기" en="Freq" /></TableHeader>
            <TableHeader><T ko="출처" en="Source" /></TableHeader>
            <TableHeader><T ko="지역" en="Region" /></TableHeader>
            <TableHeader><T ko="통화" en="Currency" /></TableHeader>
            <TableHeader align="right"><T ko="현재 값" en="Value" /></TableHeader>
            <TableHeader align="right"><T ko="이전 값" en="Prev" /></TableHeader>
            <TableHeader align="right"><T ko="변화율" en="Change" /></TableHeader>
            <TableHeader align="right"><T ko="1년 백분위" en="1Y pctile" /></TableHeader>
            <TableHeader align="right"><T ko="20일 변동성" en="Vol 20D" /></TableHeader>
          </tr>
        </thead>
        <tbody>
          {factors.map((factor) => (
            <tr key={factor.key} className="border-t border-[var(--wash)]">
              <TableCell strong>{marketLabel(factor.key)}</TableCell>
              <TableCell>{factor.name}</TableCell>
              <TableCell>{factor.date}</TableCell>
              <TableCell>{marketLabel(factor.frequency)}</TableCell>
              <TableCell><details><summary><T ko="조회 근거" en="Source details" /></summary>{factor.source}<br/>{factor.key} · {factor.family} · {factor.frequency} · {factor.region}</details></TableCell>
              <TableCell>{marketLabel(factor.region)}</TableCell>
              <TableCell>{factor.relatedCurrency}</TableCell>
              <TableCell align="right">{formatDecimal(factor.value, 4)}</TableCell>
              <TableCell align="right">
                {formatDecimal(factor.prevValue, 4)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(factor.changePct, 4)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(factor.percentile1y, 3)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(factor.volatility20dPct, 3)}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTableMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-[var(--muted)]">
      {children}
    </p>
  );
}

function TableHeader({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "border-b border-[var(--line)] px-2 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  strong = false,
  align = "left",
}: {
  children: ReactNode;
  strong?: boolean;
  align?: "left" | "right";
}) {
  return (
    <td
      className={cn(
        "border-b border-[var(--wash)] px-2 py-2 align-top",
        strong ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

function formatDecimal(value: string | null, maximumFractionDigits: number) {
  if (value === null) return "—";

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(numericValue);
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function marketLabel(value: string) {
 const labels: Record<string, [string, string]> = {fx:["환율","Exchange rates"],sovereign_yield:["국채 금리","Government bond yields"],yield_curve:["장단기 금리차","Yield curve"],daily:["매일","Daily"],weekly:["매주","Weekly"],monthly:["매월","Monthly"],korea:["한국","Korea"],us:["미국","United States"],usdkrw:["달러·원 환율","USD/KRW"],us_10y_yield:["미국 10년 국채금리","US 10-year Treasury yield"],us_10y2y_curve:["미국 10년·2년 금리차","US 10Y–2Y spread"]};
 const label=Object.hasOwn(labels,value)?labels[value]:["기타 지표 · 근거 확인","Other indicator · review source"];
 return <T ko={label[0]} en={label[1]} />;
}
