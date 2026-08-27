import Link from "next/link";

import type { PortfolioRiskReadModel } from "@/lib/portfolio-risk-read-model";

const WINDOWS = [30, 90, 252] as const;

export function PortfolioStructureRiskAnalytics({
  model,
  scopeKey,
  totalHoldingCount,
}: {
  model: PortfolioRiskReadModel;
  scopeKey: string;
  totalHoldingCount: number;
}) {
  const portfolio = model.calculation.portfolio;
  const observationLabel = `${model.provenance.usableReturnObservations}/${model.provenance.requestedReturnObservations}일`;
  const excludedHoldingCount = Math.max(
    0,
    totalHoldingCount - model.provenance.includedInstrumentCount,
  );

  return (
    <section
      aria-labelledby="portfolio-risk-landscape-title"
      className="border-t border-[#d9ddd7] pt-9 lg:pt-12"
      data-section="portfolio-risk-landscape"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[#7b8079]">RISK LANDSCAPE</p>
          <h2
            className="mt-2 text-2xl font-medium tracking-normal text-[#171a16] sm:text-3xl"
            id="portfolio-risk-landscape-title"
          >
            위험 지형
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d736b]">
            각 종목이 따로 움직이는지, 하락할 때 함께 무너지는지, 위험이 몇
            종목에 집중되는지를 같은 KRW 투자자 수익률로 봅니다.
          </p>
        </div>

        <div className="flex items-center gap-1 border-b border-[#d9ddd7] text-sm">
          {WINDOWS.map((window) => (
            <Link
              aria-current={model.selection.window === window ? "page" : undefined}
              className={`px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#347e62] ${
                model.selection.window === window
                  ? "border-b border-[#20231f] text-[#20231f]"
                  : "text-[#7b8079] hover:text-[#20231f]"
              }`}
              href={riskWindowHref(scopeKey, window)}
              key={window}
              scroll={false}
            >
              {window === 252 ? "1년" : `${window}일`}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-[#e1e4df] py-3 text-xs text-[#6f756d]">
        <span className="font-medium text-[#30352f]">
          {riskStatusLabel(model)}
        </span>
        <span>관측 {observationLabel}</span>
        <span>
          시계열 종목 {model.provenance.includedInstrumentCount}/{totalHoldingCount}개
        </span>
        <span>
          {formatDate(model.provenance.firstServiceDate)} ~ {formatDate(model.provenance.lastServiceDate)}
        </span>
        <span>KRW 환산 수익률</span>
        {excludedHoldingCount > 0 ? (
          <span className="text-[#8a6230]">
            시계열 없는 특수자산 {excludedHoldingCount}개 제외
          </span>
        ) : null}
        {model.inputHealth.status === "partial" ? (
          <span className="text-[#a36b22]">일부 관측치로 계산</span>
        ) : null}
      </div>

      {portfolio ? (
        <>
          <RiskMetricStrip model={model} />

          <div className="mt-12 grid gap-12 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] xl:gap-14">
            <CorrelationMatrix
              instruments={model.calculation.instruments}
              matrix={portfolio.correlationMatrix}
              title="평균 상관계수 행렬"
              description="붉을수록 같이 움직이고, 초록일수록 서로 다른 방향으로 움직입니다. 대각선은 자기 자신입니다."
            />

            <RiskContributionList model={model} />
          </div>

          <div className="mt-12 border-t border-[#e1e4df] pt-10">
            {portfolio.stress.correlationMatrix ? (
              <CorrelationMatrix
                instruments={model.calculation.instruments}
                matrix={portfolio.stress.correlationMatrix}
                title="스트레스 상관계수"
                description={`포트폴리오가 하락한 ${portfolio.stress.downDayObservations}일만 다시 계산했습니다. 평소보다 붉어지면 위기 때 분산 효과가 약해진다는 뜻입니다.`}
              />
            ) : (
              <div className="py-8">
                <p className="text-lg font-medium">스트레스 상관계수</p>
                <p className="mt-2 text-sm leading-6 text-[#737970]">
                  하락일이 {portfolio.stress.downDayObservations}일이라 최소 {portfolio.stress.minimumObservations}일 기준을 충족하지 못했습니다.
                </p>
              </div>
            )}
          </div>

          <RiskMetricGuide />
        </>
      ) : (
        <RiskUnavailable model={model} />
      )}
    </section>
  );
}

function RiskMetricStrip({ model }: { model: PortfolioRiskReadModel }) {
  const portfolio = model.calculation.portfolio;
  if (!portfolio) return null;
  const kodexBeta = model.pathAnalytics.benchmarkBetas.find(
    (benchmark) => benchmark.id === "kodex200",
  );
  const vooBeta = model.pathAnalytics.benchmarkBetas.find(
    (benchmark) => benchmark.id === "voo",
  );

  const metrics = [
    {
      label: "유효 종목 수 (ENB)",
      value: formatMetric(portfolio.riskContributionEnb.value, 2),
      detail: `${model.calculation.instruments.length}개 중 위험 분산 효과`,
    },
    {
      label: "평균 상관",
      value: formatMetric(portfolio.weightedAverageCorrelation.value, 2),
      detail: "비중을 반영한 종목 쌍 평균",
    },
    {
      label: "스트레스 상관",
      value: formatMetric(
        portfolio.stress.weightedAverageCorrelation.value,
        2,
      ),
      detail: `하락일 ${portfolio.stress.downDayObservations}일`,
    },
    {
      label: "Sharpe",
      value: formatMetric(portfolio.sharpe.value, 2),
      detail: "무위험 수익률 0% 가정",
    },
    {
      label: "연환산 변동성",
      value: formatRatioPercent(portfolio.volatilityAnnualized),
      detail: "일별 변동을 252일로 환산",
    },
    {
      label: "최대 낙폭 (MDD)",
      value: formatPercentPoints(model.pathAnalytics.maximumDrawdownPct.value),
      detail: "선택 기간 고점 대비 최대 하락",
    },
    {
      label: "KODEX 200 베타",
      value: formatMetric(kodexBeta?.beta.value ?? null, 2),
      detail: betaDetail(kodexBeta),
    },
    {
      label: "VOO 베타",
      value: formatMetric(vooBeta?.beta.value ?? null, 2),
      detail: betaDetail(vooBeta),
    },
  ];

  return (
    <dl className="mt-8 grid border-b border-[#d9ddd7] sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric, index) => (
        <div
          className={`min-w-0 border-t border-r border-[#e1e4df] px-4 py-5 last:border-r-0 ${
            index % 4 === 3 ? "lg:border-r-0" : ""
          }`}
          key={metric.label}
        >
          <dt className="text-xs font-medium text-[#6c726a]">{metric.label}</dt>
          <dd className="mt-3 text-2xl font-medium tabular-nums text-[#1d211c]">
            {metric.value}
          </dd>
          <p className="mt-2 truncate text-xs text-[#7a8078]" title={metric.detail}>
            {metric.detail}
          </p>
        </div>
      ))}
    </dl>
  );
}

function CorrelationMatrix({
  description,
  instruments,
  matrix,
  title,
}: {
  description: string;
  instruments: PortfolioRiskReadModel["calculation"]["instruments"];
  matrix: Array<Array<number | null>>;
  title: string;
}) {
  const cellSize = instruments.length > 12 ? 29 : 34;
  const minimumWidth = 210 + instruments.length * (cellSize + 3);

  return (
    <section aria-label={title} className="min-w-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-medium text-[#20231f]">{title}</h3>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[#757b73]">
            {description}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#7b8079]">
          <span>분산</span>
          <span className="h-2 w-14 rounded-full bg-[#74b696]" />
          <span className="h-2 w-14 rounded-full bg-[#eceeea]" />
          <span className="h-2 w-14 rounded-full bg-[#dc7772]" />
          <span>동조</span>
        </div>
      </div>

      <div className="mt-5 max-w-full overflow-x-auto pb-2">
        <table
          className="border-separate border-spacing-[3px]"
          style={{ minWidth: minimumWidth }}
        >
          <thead>
            <tr>
              <th className="w-[200px]" />
              {instruments.map((instrument) => (
                <th
                  className="h-28 align-bottom text-[10px] font-normal text-[#60665f]"
                  key={instrument.instrumentKey}
                  style={{ width: cellSize }}
                  title={instrumentName(instrument)}
                >
                  <span
                    className="mx-auto block max-h-24 overflow-hidden"
                    style={{
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                    }}
                  >
                    {instrumentName(instrument)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instruments.map((instrument, rowIndex) => (
              <tr key={instrument.instrumentKey}>
                <th
                  className="max-w-[200px] truncate pr-3 text-left text-xs font-medium text-[#30352f]"
                  title={`${instrumentName(instrument)} · ${instrument.ticker}`}
                >
                  {instrumentName(instrument)}
                </th>
                {instruments.map((column, columnIndex) => {
                  const value = matrix[rowIndex]?.[columnIndex] ?? null;
                  return (
                    <td
                      className="rounded-[4px] text-center text-[9px] tabular-nums text-[#343a34]"
                      key={column.instrumentKey}
                      style={{
                        background: correlationCellBackground(value),
                        height: cellSize,
                        minWidth: cellSize,
                        width: cellSize,
                      }}
                      title={`${instrumentName(instrument)} / ${instrumentName(column)}: ${formatMetric(value, 2)}`}
                    >
                      {value === null ? "" : value.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RiskContributionList({ model }: { model: PortfolioRiskReadModel }) {
  const rows = [...model.calculation.instruments].sort(
    (left, right) =>
      (right.absoluteRiskSharePct ?? -1) - (left.absoluteRiskSharePct ?? -1),
  );
  const maximumShare = Math.max(
    1,
    ...rows.map((row) => row.absoluteRiskSharePct ?? 0),
  );

  return (
    <section aria-labelledby="risk-contribution-title" className="min-w-0">
      <h3 className="text-lg font-medium" id="risk-contribution-title">
        종목별 위험 기여
      </h3>
      <p className="mt-2 text-xs leading-5 text-[#757b73]">
        투자금 비중이 아니라 전체 변동성에 실제로 더한 몫입니다. 값이 큰 종목부터 표시합니다.
      </p>

      <div className="mt-5 divide-y divide-[#e4e7e2] border-y border-[#d9ddd7]">
        {rows.map((row) => {
          const share = row.absoluteRiskSharePct;
          return (
            <div
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_90px] items-center gap-4 py-3"
              key={row.instrumentKey}
            >
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium" title={instrumentName(row)}>
                    {instrumentName(row)}
                  </p>
                  <p className="shrink-0 text-xs tabular-nums text-[#6f756d]">
                    비중 {formatRatioPercent(row.weight)}
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e7eae5]">
                  <div
                    className="h-full rounded-full bg-[#4e8d73]"
                    style={{ width: `${Math.max(0, ((share ?? 0) / maximumShare) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium tabular-nums">
                  {formatPercentPoints(share)}
                </p>
                <p className="mt-1 text-[10px] text-[#7a8078]">
                  Sharpe {formatMetric(row.sharpe.value, 1)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RiskMetricGuide() {
  return (
    <details className="group mt-10 border-y border-[#d9ddd7] py-1">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#347e62]">
        <span>지표 읽는 법</span>
        <span className="text-xs font-normal text-[#747a72] group-open:hidden">설명 보기 ＋</span>
        <span className="hidden text-xs font-normal text-[#747a72] group-open:inline">접기 －</span>
      </summary>
      <div className="grid gap-x-10 gap-y-7 border-t border-[#e4e7e2] py-7 sm:grid-cols-2 lg:grid-cols-3">
        <GuideItem
          title="ENB"
          body="위험이 똑같이 나뉘었다고 볼 수 있는 종목 수입니다. 보유 종목은 많아도 ENB가 낮으면 실제 위험은 몇 종목에 몰려 있습니다."
        />
        <GuideItem
          title="평균 상관"
          body="1에 가까울수록 같은 방향, 0은 관계가 약함, 음수는 반대 방향입니다. 낮을수록 분산에 유리하지만 항상 수익이 높다는 뜻은 아닙니다."
        />
        <GuideItem
          title="스트레스 상관"
          body="포트폴리오가 하락한 날만 골라 계산합니다. 평소 상관보다 높다면 위기 때 종목들이 함께 하락하는 구조입니다."
        />
        <GuideItem
          title="Sharpe"
          body="감수한 변동성 한 단위당 얻은 수익입니다. 높을수록 효율적이지만, 현재는 비교 가능한 무위험 수익률 원천이 확정되지 않아 0%를 가정합니다."
        />
        <GuideItem
          title="베타"
          body="기준지수가 1% 움직일 때 포트폴리오가 평균적으로 얼마나 민감하게 움직였는지 나타냅니다. KODEX 200과 VOO를 따로 표시해 기준 혼동을 막습니다."
        />
        <GuideItem
          title="MDD"
          body="선택한 기간 중 고점에서 저점까지 가장 크게 줄어든 폭입니다. 실제 손실 경험의 크기를 직관적으로 보여주지만 미래 최대 손실을 보장하지는 않습니다."
        />
      </div>
    </details>
  );
}

function GuideItem({ body, title }: { body: string; title: string }) {
  return (
    <div>
      <h4 className="text-sm font-medium text-[#282d27]">{title}</h4>
      <p className="mt-2 text-xs leading-5 text-[#71776f]">{body}</p>
    </div>
  );
}

function RiskUnavailable({ model }: { model: PortfolioRiskReadModel }) {
  return (
    <div className="mt-8 border-y border-[#d9ddd7] py-10">
      <p className="text-lg font-medium">위험 분석 근거가 아직 충분하지 않습니다.</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#747a72]">
        현재 {model.provenance.usableReturnObservations}/{model.provenance.requestedReturnObservations}일의 수익률을 사용할 수 있습니다. 가격 이력을 지우거나 임의 평균으로 채우지 않고, 승인된 조정종가가 쌓이면 같은 화면에서 자동 계산합니다.
      </p>
    </div>
  );
}

function correlationCellBackground(value: number | null) {
  if (value === null) {
    return "repeating-linear-gradient(135deg, #eceeea 0, #eceeea 3px, #f7f8f5 3px, #f7f8f5 6px)";
  }
  if (value >= 0) {
    const alpha = 0.12 + Math.min(value, 1) * 0.72;
    return `rgba(211, 84, 78, ${alpha})`;
  }
  const alpha = 0.12 + Math.min(Math.abs(value), 1) * 0.72;
  return `rgba(54, 143, 102, ${alpha})`;
}

function riskWindowHref(scopeKey: string, window: number) {
  const query = new URLSearchParams({ scope: scopeKey, window: String(window) });
  return `/portfolio/structure?${query.toString()}`;
}

function instrumentName(
  instrument: PortfolioRiskReadModel["calculation"]["instruments"][number],
) {
  return instrument.names[0]?.trim() || instrument.ticker;
}

function riskStatusLabel(model: PortfolioRiskReadModel) {
  if (model.calculation.calculationStatus === "complete") return "계산 완료";
  if (model.calculation.calculationStatus === "standalone_only") return "단일 종목 분석";
  if (model.inputHealth.status === "insufficient_coverage") return "가격 이력 부족";
  if (model.inputHealth.status === "blocked") return "중복 근거 검토 필요";
  return "계산 대기";
}

function betaDetail(
  benchmark:
    | PortfolioRiskReadModel["pathAnalytics"]["benchmarkBetas"][number]
    | undefined,
) {
  if (!benchmark) return "기준지수 근거 없음";
  if (benchmark.beta.value !== null) return `${benchmark.observationCount}일 정렬 관측`;
  if (benchmark.beta.reason === "zero_benchmark_variance") return "기준지수 변동 없음";
  return "정렬 가능한 가격 이력 부족";
}

function formatMetric(value: number | null, digits: number) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatRatioPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%`;
}

function formatPercentPoints(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}
